# Micro-World Patterns

This reference provides four micro-world patterns for comprehend explainer artifacts. A micro-world is a small interactive widget that lets the reader FEEL a behavior rather than just read about it.

## Ground Rules

1. Always label as "simplified model" -- never present as the real code.
2. Be faithful on the teaching dimension: if the real code retries 3 times, the model retries 3 times.
3. Use the same toy data as the 직관 section.
4. Show the interesting range by default so the reader sees meaningful behavior immediately.
5. No external dependencies, no network requests, no imports.
6. In `--md` mode, degrade to a worked example with explicit before/after values.

## Pattern 1: Faithful Miniature

Port the key logic to JavaScript, wire it to an editable input.

```html
<div class="world">
  <h4>직접 만져보기 <span class="note warn">simplified model</span></h4>
  <label>Input: <input id="mw-in" value="Hello World"></label>
  <p>Output: <code id="mw-out"></code></p>
  <script>
    (() => {
      const input = document.getElementById('mw-in');
      const output = document.getElementById('mw-out');
      function update() {
        output.textContent = input.value.toLowerCase().replace(/\s+/g, '-');
      }
      input.addEventListener('input', update);
      update();
    })();
  </script>
</div>
```

## Pattern 2: Slider

A range input for threshold or sensitivity exploration.

```html
<div class="world">
  <h4>직접 만져보기 <span class="note warn">simplified model</span></h4>
  <label>Retry delay (ms): <input type="range" id="mw-delay" min="100" max="5000" value="1000"></label>
  <p>Delay: <code id="mw-val">1000</code>ms &rarr; Total wait: <code id="mw-total">3000</code>ms</p>
  <script>
    (() => {
      const slider = document.getElementById('mw-delay');
      const val = document.getElementById('mw-val');
      const total = document.getElementById('mw-total');
      function update() {
        const d = Number(slider.value);
        val.textContent = d;
        total.textContent = d + d * 2 + d * 4;
      }
      slider.addEventListener('input', update);
      update();
    })();
  </script>
</div>
```

## Pattern 3: Step-through

Next/reset buttons for visualizing a pipeline or sequence.

```html
<div class="world">
  <h4>직접 만져보기 <span class="note warn">simplified model</span></h4>
  <div id="mw-steps"></div>
  <button id="mw-next">Next</button>
  <button id="mw-reset">Reset</button>
  <script>
    (() => {
      const steps = ['Parse input', 'Validate schema', 'Transform data', 'Write output'];
      let current = 0;
      const container = document.getElementById('mw-steps');
      function render() {
        container.innerHTML = steps.map((s, i) =>
          '<div class="box' + (i < current ? ' done' : i === current ? ' active' : '') + '">' + s + '</div>'
        ).join('');
      }
      document.getElementById('mw-next').addEventListener('click', () => {
        if (current <= steps.length) { current++; render(); }
      });
      document.getElementById('mw-reset').addEventListener('click', () => {
        current = 0; render();
      });
      render();
    })();
  </script>
</div>
```

## Pattern 4: Old/New Toggle

Radio buttons comparing before and after behavior.

```html
<div class="world">
  <h4>직접 만져보기 <span class="note warn">simplified model</span></h4>
  <label><input type="radio" name="mw-ver" value="old" checked> Before</label>
  <label><input type="radio" name="mw-ver" value="new"> After</label>
  <pre id="mw-display">old output here</pre>
  <script>
    (() => {
      const display = document.getElementById('mw-display');
      const outputs = { old: 'old output here', new: 'new output here' };
      document.querySelectorAll('input[name="mw-ver"]').forEach(r => {
        r.addEventListener('change', () => { display.textContent = outputs[r.value]; });
      });
    })();
  </script>
</div>
```
