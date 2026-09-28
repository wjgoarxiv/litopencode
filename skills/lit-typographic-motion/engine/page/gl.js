// Browser side, part 2: WebGL2 plumbing. Half-float linear-HDR targets, a fullscreen pass whose
// uniform setter is the single logging choke point (MO-SH-00a), Canvas2D layers uploaded as sRGB
// textures, and an asynchronous, fence-synced pixel readback.
(() => {
  const LTM = window.LTM;

  LTM.createGL = (scale) => {
    const W = 1920 * scale, H = 1080 * scale;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, premultipliedAlpha: false });
    if (!gl) return { error: "NO_WEBGL2" };
    const floatTargets = gl.getExtension("EXT_color_buffer_float");
    if (!floatTargets) return { error: "NO_WEBGL2: EXT_color_buffer_float is unavailable, so linear-HDR targets cannot be rendered" };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unknown (debug-info extension unavailable)";

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const program = (vertex, fragment, attribs = ["a_pos"]) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
      attribs.forEach((name, index) => gl.bindAttribLocation(p, index, name));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program link failed: ${gl.getProgramInfoLog(p)}`);
      return p;
    };
    const fsVertex = `#version 300 es
in vec2 a_pos; out vec2 vUv;
void main() { vUv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

    const makeTarget = (width, height, kind = "f16") => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const internal = kind === "u8" ? gl.RGBA8 : gl.RGBA16F;
      const type = kind === "u8" ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT;
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`render target ${kind} ${width}x${height} is incomplete`);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, width, height, kind };
    };
    const bindTarget = (target) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.width : W, target ? target.height : H);
    };
    const clearTarget = (target, rgb, alpha = 1) => {
      bindTarget(target);
      gl.disable(gl.BLEND);
      gl.clearColor(rgb[0], rgb[1], rgb[2], alpha);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };

    // The frame log every pass writes through. begin() opens a frame; the uniform setter and the
    // draw call below are the only way a pass reaches the GPU, so no pass can skip the log.
    const log = { lines: new Map(), open: false, recordUniforms: false };
    log.begin = () => { log.lines = new Map(); log.open = true; log.recordUniforms = false; };
    log.entry = (passId) => {
      if (!log.lines.has(passId)) log.lines.set(passId, { pass: passId, draws: 0, uniforms: {} });
      return log.lines.get(passId);
    };
    log.end = () => { log.open = false; return [...log.lines.values()]; };

    class Pass {
      constructor(id, fragmentBody, { logged = true } = {}) {
        this.id = id;
        this.logged = logged;
        this.program = program(fsVertex, LTM.glslHeader + fragmentBody);
        this.locations = new Map();
        this.textureUnit = 0;
      }
      loc(name) {
        if (!this.locations.has(name)) this.locations.set(name, gl.getUniformLocation(this.program, name));
        return this.locations.get(name);
      }
      use() { gl.useProgram(this.program); this.textureUnit = 0; this.set("u_res", "vec2", [W, H], false); this.set("u_scale", "float", scale, false); return this; }
      set(name, kind, value, record = true) {
        const location = this.loc(name);
        if (location !== null) {
          if (kind === "float") gl.uniform1f(location, value);
          else if (kind === "int") gl.uniform1i(location, value);
          else if (kind === "uint") gl.uniform1ui(location, value >>> 0);
          else if (kind === "bool") gl.uniform1i(location, value ? 1 : 0);
          else if (kind === "vec2") gl.uniform2fv(location, value);
          else if (kind === "vec3") gl.uniform3fv(location, value);
          else if (kind === "vec4") gl.uniform4fv(location, value);
          else if (kind === "vec3[]") gl.uniform3fv(location, value.flat());
          else if (kind === "vec4[]") gl.uniform4fv(location, value.flat());
          else throw new Error(`unknown uniform kind ${kind}`);
        }
        if (record && this.logged && log.open && log.recordUniforms) log.entry(this.id).uniforms[name] = kind === "uint" ? value >>> 0 : value;
        return this;
      }
      texture(name, tex) {
        gl.activeTexture(gl.TEXTURE0 + this.textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(this.loc(name), this.textureUnit);
        this.textureUnit += 1;
        return this;
      }
      draw(target, blend = "none") {
        bindTarget(target);
        if (blend === "none") gl.disable(gl.BLEND);
        else {
          gl.enable(gl.BLEND);
          if (blend === "add") gl.blendFunc(gl.ONE, gl.ONE);
          else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        if (this.logged && log.open) log.entry(this.id).draws += 1;
        return this;
      }
    }

    // A Canvas2D surface in logical px uploaded as an SRGB8_ALPHA8 texture, so sampling yields
    // linear colour. `willReadFrequently` keeps it on the CPU rasterizer (stable bytes run to run).
    // Rows are uploaded top-down (no flip; shaders sample at 1 - v). After the first full upload only
    // the rectangle that changed is re-sent; pixels outside it are identical by construction.
    const makeLayer = () => {
      const surface = document.createElement("canvas");
      surface.width = W; surface.height = H;
      const ctx = surface.getContext("2d", { willReadFrequently: true, alpha: true });
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      let uploaded = false;
      let previous = null;
      const clampRect = (r) => {
        const x0 = Math.max(0, Math.floor(r[0] * scale) - 4), y0 = Math.max(0, Math.floor(r[1] * scale) - 4);
        const x1 = Math.min(W, Math.ceil(r[2] * scale) + 4), y1 = Math.min(H, Math.ceil(r[3] * scale) + 4);
        return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
      };
      const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
      return {
        canvas: surface, ctx, tex,
        clear() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.setTransform(scale, 0, 0, scale, 0, 0); },
        // `rects` are the logical boxes drawn this time; null means "unknown, send everything".
        upload(rects = null) {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          const current = rects === null ? [0, 0, W, H] : rects.map(clampRect).reduce(union, null);
          if (!uploaded || rects === null) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, surface);
            uploaded = true;
          } else {
            const dirty = union(previous, current);
            if (dirty) {
              gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, dirty[0]);
              gl.pixelStorei(gl.UNPACK_SKIP_ROWS, dirty[1]);
              gl.texSubImage2D(gl.TEXTURE_2D, 0, dirty[0], dirty[1], dirty[2] - dirty[0], dirty[3] - dirty[1], gl.RGBA, gl.UNSIGNED_BYTE, surface);
              gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
              gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
            }
          }
          previous = rects === null ? null : current;
          return tex;
        }
      };
    };

    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, W * H * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    // GPU-synced readback: readPixels into a pack buffer, fence, poll, then copy out.
    const readPixelsAsync = async (target, out) => {
      bindTarget(target);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      for (;;) {
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
        if (status === gl.WAIT_FAILED) throw new Error("GPU fence wait failed during readback");
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      gl.deleteSync(sync);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return out;
    };

    return { gl, canvas, renderer, W, H, scale, program, makeTarget, bindTarget, clearTarget, makeLayer, readPixelsAsync, Pass, log, vao };
  };
})();
