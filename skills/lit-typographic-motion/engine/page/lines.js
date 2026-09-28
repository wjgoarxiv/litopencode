// Browser side, part 3: GPU-instanced anti-aliased capsule segments in logical 2D px (x right,
// y down). swiss-grid draws its hairline rules with one instanced call; scenes use the same batch
// for small graphic marks. Colours are linear RGB, alpha 0..1.
(() => {
  const LTM = window.LTM;

  LTM.createLineBatch = (core, capacity = 512) => {
    const { gl } = core;
    const vertex = `#version 300 es
in vec2 a_corner; in vec2 i_a; in vec2 i_b; in vec4 i_color; in float i_width;
uniform vec2 u_logical; uniform float u_scale;
out vec2 v_local; out float v_len; out float v_half; out vec4 v_color;
void main() {
  vec2 a = i_a * u_scale, b = i_b * u_scale;
  float w = i_width * u_scale;
  float hw = max(w * 0.5, 0.35) + 1.0;
  vec2 d = b - a; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float along = mix(-hw, len + hw, a_corner.x);
  vec2 p = a + dir * along + nrm * a_corner.y * hw;
  vec2 res = u_logical * u_scale;
  gl_Position = vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0);
  v_local = vec2(along, a_corner.y * hw); v_len = len; v_half = max(w * 0.5, 0.35);
  v_color = i_color * vec4(1.0, 1.0, 1.0, min(1.0, w / 0.7));
}`;
    const fragment = `#version 300 es
precision highp float;
in vec2 v_local; in float v_len; in float v_half; in vec4 v_color;
out vec4 fragColor;
void main() {
  float x = clamp(v_local.x, 0.0, v_len);
  float d = length(vec2(v_local.x - x, v_local.y)) - v_half;
  float a = clamp(0.5 - d, 0.0, 1.0) * v_color.a;
  if (a <= 0.0) discard;
  fragColor = vec4(v_color.rgb * a, a);
}`;
    const program = core.program(vertex, fragment, ["a_corner", "i_a", "i_b", "i_color", "i_width"]);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const stride = 9 * 4;
    const data = new Float32Array(capacity * 9);
    const instances = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    const attr = (index, size, offset) => {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(index, 1);
    };
    attr(1, 2, 0); attr(2, 2, 2); attr(3, 4, 4); attr(4, 1, 8);
    gl.bindVertexArray(null);
    let count = 0;
    const uLogical = gl.getUniformLocation(program, "u_logical");
    const uScale = gl.getUniformLocation(program, "u_scale");
    return {
      clear() { count = 0; },
      get count() { return count; },
      seg(ax, ay, bx, by, width, rgb, alpha = 1) {
        if (count >= capacity) throw new Error("line batch capacity exceeded");
        data.set([ax, ay, bx, by, rgb[0], rgb[1], rgb[2], alpha, width], count * 9);
        count += 1;
      },
      // Draws premultiplied over `target`. Returns the number of draw calls issued (0 or 1).
      draw(target) {
        if (count === 0) return 0;
        core.bindTarget(target);
        gl.useProgram(program);
        gl.uniform2f(uLogical, 1920, 1080);
        gl.uniform1f(uScale, core.scale);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, instances);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * 9));
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
        return 1;
      }
    };
  };
})();
