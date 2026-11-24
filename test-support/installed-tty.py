"""Run an installer with all three streams on a PTY; bound and record every prompt."""
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

request = json.load(sys.stdin)
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", request.get("rows", 40), request.get("cols", 120), 0, 0))
# A card run lists [text to wait for, keys to send]; each wait starts after the text the last one matched.
steps = [[re.compile(wait.encode()), keys.encode()] for wait, keys in request.get("steps", [])]
steps_at = 0
steps_sent = 0
child = None
output = bytearray()
answers = []
timed_out = False
try:
    child = subprocess.Popen(request["argv"], cwd=request["cwd"], env=request["env"],
                             stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    # This end stays open until the child is gone and everything is read: a reader that falls behind must not
    # lose the child's last lines when the child closes its own.
    deadline = time.monotonic() + (90 if "steps" in request else 25)
    while True:
        if time.monotonic() >= deadline:
            timed_out = True
            break
        if not select.select([master], [], [], 0.1)[0]:
            if child.poll() is not None:
                break
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not chunk:
            break
        output.extend(chunk)
        while steps:
            found = steps[0][0].search(output, steps_at)
            if found is None:
                break
            steps_at = found.end()
            time.sleep(0.1)
            os.write(master, steps.pop(0)[1])
            steps_sent += 1
        prompts = [] if "steps" in request else re.findall(rb"Select \d+-\d+ \[\d+\]: ", output)
        while len(answers) < len(prompts):
            if len(answers) >= 8:
                raise RuntimeError("installer exceeded the bounded prompt budget")
            choices = request.get("answers", [])
            answer = choices[len(answers)] if len(answers) < len(choices) else ""
            answers.append(answer)
            os.write(master, (answer + "\n").encode())
    child.wait(timeout=5)
finally:
    if child is not None and child.poll() is None:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=5)
    os.close(master)
    if slave is not None:
        os.close(slave)

json.dump({"exit": child.returncode, "output": output.decode("utf-8", errors="replace"),
           "answers": answers, "stepsSent": steps_sent, "timedOut": timed_out, "childReaped": child.poll() is not None,
           "ptyClosed": True}, sys.stdout)
