const vertex = `#version 300 es
in vec2 a;out vec2 uv;void main(){uv=a*.5+.5;gl_Position=vec4(a,0.,1.);}`;
const noise = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float field(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
float birth(vec2 q){float sweep=axis==2.?1.-q.y:axis==1.?q.x:axis==3.?field(q*5.):1.-q.x;return clamp(sweep*.58+field(q*18.)*.24+hash(floor(q*resolution/3.))*.14,.02,.96);}`;
const fragment = `#version 300 es
precision highp float;in vec2 uv;out vec4 color;
uniform sampler2D live,room,mask,portrait;uniform float progress,mode,axis;uniform vec2 resolution;uniform vec3 flips;
${noise}
void main(){vec4 l=texture(live,vec2(uv.x,mix(uv.y,1.-uv.y,flips.x)));if(mode<.5){color=l;return;}vec4 bg=texture(room,vec2(uv.x,mix(uv.y,1.-uv.y,flips.y)));if(mode>2.5){color=bg;return;}
float m=smoothstep(.20,.78,texture(mask,uv).r),b=birth(uv),remain=1.-smoothstep(b-.025,b+.025,progress*1.15);
vec3 base=bg.rgb;color=vec4(mix(base,texture(portrait,vec2(uv.x,mix(uv.y,1.-uv.y,flips.z))).rgb,m*remain),1.);}`;
const particleVertex = `#version 300 es
precision highp float;in vec2 home;in vec3 seed;out vec2 sampleUV;out float opacity;
uniform float progress,axis;uniform vec2 resolution;
${noise}
void main(){float b=birth(home),age=max(0.,progress*1.15-b),born=step(b,progress*1.15);
vec2 wind=axis==1.?vec2(-1.,.15):axis==2.?vec2(.13,1.):vec2(1.,.24);if(axis==3.)wind=vec2(cos(seed.x*6.28),sin(seed.x*6.28));
vec2 drift=wind*(age*.38+age*age*1.1)*(.5+seed.x);drift+=vec2(sin(age*12.+seed.y*12.),cos(age*9.+seed.x*18.))*age*.075;
gl_Position=vec4((home+drift)*2.-1.,0.,1.);gl_PointSize=(1.1+seed.z*2.2)*(resolution.y/720.);
opacity=born*(1.-smoothstep(.12,.63,age));sampleUV=home;}`;
const particleFragment = `#version 300 es
precision highp float;in vec2 sampleUV;in float opacity;out vec4 color;uniform sampler2D portrait;uniform float flipPortrait;
void main(){float d=length(gl_PointCoord-.5);if(d>.5||opacity<.01)discard;color=vec4(texture(portrait,vec2(sampleUV.x,mix(sampleUV.y,1.-sampleUV.y,flipPortrait))).rgb*.84,opacity*(1.-smoothstep(.3,.5,d)));}`;
export class DustRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!this.gl)
      throw Error("WebGL 2 unavailable. Enable browser graphics acceleration.");
    const g = this.gl;
    const program = (v, f) => {
      const p = g.createProgram();
      for (const [type, src] of [
        [g.VERTEX_SHADER, v],
        [g.FRAGMENT_SHADER, f],
      ]) {
        const s = g.createShader(type);
        g.shaderSource(s, src);
        g.compileShader(s);
        if (!g.getShaderParameter(s, g.COMPILE_STATUS))
          throw Error(g.getShaderInfoLog(s));
        g.attachShader(p, s);
      }
      g.linkProgram(p);
      if (!g.getProgramParameter(p, g.LINK_STATUS))
        throw Error(g.getProgramInfoLog(p));
      return p;
    };
    this.base = program(vertex, fragment);
    this.dust = program(particleVertex, particleFragment);
    this.quad = g.createVertexArray();
    g.bindVertexArray(this.quad);
    const buffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      g.STATIC_DRAW,
    );
    const a = g.getAttribLocation(this.base, "a");
    g.enableVertexAttribArray(a);
    g.vertexAttribPointer(a, 2, g.FLOAT, false, 0, 0);
    this.points = g.createVertexArray();
    g.bindVertexArray(this.points);
    this.pointBuffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, this.pointBuffer);
    for (const [name, size, offset] of [
      ["home", 2, 0],
      ["seed", 3, 8],
    ]) {
      const a = g.getAttribLocation(this.dust, name);
      g.enableVertexAttribArray(a);
      g.vertexAttribPointer(a, size, g.FLOAT, false, 20, offset);
    }
    this.textures = {};
    for (const name of ["live", "room", "mask", "portrait"]) {
      const t = g.createTexture();
      this.textures[name] = t;
      g.bindTexture(g.TEXTURE_2D, t);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RGBA,
        1,
        1,
        0,
        g.RGBA,
        g.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255]),
      );
    }
    this.count = 0;
  }
  upload(name, source) {
    const g = this.gl;
    this.flips ??= {};
    this.flips[name] = source instanceof ImageBitmap ? 1 : 0;
    g.bindTexture(g.TEXTURE_2D, this.textures[name]);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, source);
  }
  setMask(mask) {
    this.mask = mask;
    const g = this.gl;
    g.bindTexture(g.TEXTURE_2D, this.textures.mask);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    const bytes = new Uint8Array(mask.width * mask.height);
    for (let y = 0; y < mask.height; y++)
      for (let x = 0; x < mask.width; x++)
        bytes[(mask.height - 1 - y) * mask.width + x] = Math.round(
          mask.data[y * mask.width + x] * 255,
        );
    g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.R8,
      mask.width,
      mask.height,
      0,
      g.RED,
      g.UNSIGNED_BYTE,
      bytes,
    );
  }
  snapshot(image) {
    this.upload("portrait", image);
    const m = this.mask;
    if (!m) return;
    const points = [];
    let s = 7301;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 52000; i++) {
      const x = rand(),
        y = rand();
      if (
        m.data[
          Math.min(m.height - 1, Math.floor(y * m.height)) * m.width +
            Math.min(m.width - 1, Math.floor(x * m.width))
        ] > 0.45
      )
        points.push(x, 1 - y, rand(), rand(), rand());
    }
    const g = this.gl;
    g.bindBuffer(g.ARRAY_BUFFER, this.pointBuffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(points), g.STATIC_DRAW);
    this.count = points.length / 5;
  }
  render(
    image,
    { width, height, progress = 0, mode = 0, direction = "right" },
  ) {
    const g = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    g.viewport(0, 0, width, height);
    g.activeTexture(g.TEXTURE0);
    this.upload("live", image);
    const setup = (p) => {
      g.useProgram(p);
      ["live", "room", "mask", "portrait"].forEach((name, i) => {
        g.activeTexture(g.TEXTURE0 + i);
        g.bindTexture(g.TEXTURE_2D, this.textures[name]);
        g.uniform1i(g.getUniformLocation(p, name), i);
      });
      g.uniform1f(g.getUniformLocation(p, "progress"), progress);
      g.uniform1f(g.getUniformLocation(p, "mode"), mode);
      g.uniform1f(
        g.getUniformLocation(p, "axis"),
        { right: 0, left: 1, up: 2, vortex: 3 }[direction] || 0,
      );
      g.uniform2f(g.getUniformLocation(p, "resolution"), width, height);
      g.uniform3f(
        g.getUniformLocation(p, "flips"),
        this.flips.live || 0,
        this.flips.room || 0,
        this.flips.portrait || 0,
      );
      g.uniform1f(
        g.getUniformLocation(p, "flipPortrait"),
        this.flips.portrait || 0,
      );
    };
    g.disable(g.BLEND);
    setup(this.base);
    g.bindVertexArray(this.quad);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    if (mode > 0.5 && mode < 2.5 && progress > 0 && progress < 1) {
      setup(this.dust);
      g.bindVertexArray(this.points);
      g.enable(g.BLEND);
      g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
      g.drawArrays(g.POINTS, 0, this.count);
      g.disable(g.BLEND);
    }
  }
}
