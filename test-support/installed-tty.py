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
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
child = None
output = bytearray()
answers = []
timed_out = False
try:
    child = subprocess.Popen(request["argv"], cwd=request["cwd"], env=request["env"],
                             stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    slave = None
    deadline = time.monotonic() + 25
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
        prompts = re.findall(rb"Select \d+-\d+ \[\d+\]: ", output)
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
           "answers": answers, "timedOut": timed_out, "childReaped": child.poll() is not None,
           "ptyClosed": True}, sys.stdout)
