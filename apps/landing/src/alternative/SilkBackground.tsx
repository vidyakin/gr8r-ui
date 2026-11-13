import { useEffect, useRef } from 'react';
import fragmentSource from './silk.frag?raw';

const vertexSource = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate Silk shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Silk shader compilation failed: ${message}`);
  }
  return shader;
}

function createRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error('WebGL1 is unavailable');

  const program = gl.createProgram();
  if (!program) throw new Error('Unable to allocate Silk program');
  const shaders: WebGLShader[] = [];
  let buffer: WebGLBuffer | null = null;
  try {
    shaders.push(compile(gl, gl.VERTEX_SHADER, vertexSource));
    shaders.push(compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Silk shader linking failed: ${gl.getProgramInfoLog(program)}`);
    }

    buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to allocate Silk triangle');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // Один треугольник перекрывает весь viewport без шва по диагонали.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform3fv(uniform('u_colors[0]'), new Float32Array([
      0.012, 0.071, 0.055,
      0.055, 0.486, 0.353,
      0.486, 0.898, 0.467,
      0.957, 1.000, 0.780,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]));
    gl.uniform4f(uniform('u_shape'), 1.28, 0.47, 0.50, 0.00);
    gl.uniform4f(uniform('u_surface'), 2.40, 0.98, 0.00, 1.00);
    gl.uniform4f(uniform('u_finish'), 0.00, 0.00, 0.000, 0.01);
    gl.uniform4f(uniform('u_transform'), 707.0, 0.00, 0.00, 0.0);
    gl.uniform4f(uniform('u_space'), 0.00, 0.00, 0.00, 0.00);
    gl.uniform4f(uniform('u_cursor'), 0.00, 2.0, 0.65, 0.46);
    const scene = uniform('u_scene');

    return {
      draw(seconds: number) {
        const { width, height } = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const nextWidth = Math.max(1, Math.round(width * dpr));
        const nextHeight = Math.max(1, Math.round(height * dpr));
        if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
          canvas.width = nextWidth;
          canvas.height = nextHeight;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform4f(scene, canvas.width, canvas.height, seconds * 0.42, 4.0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose() {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      },
    };
  } catch (error) {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

export function SilkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let renderer: ReturnType<typeof createRenderer> | null = null;
    let frame = 0;
    let seconds = 0;
    let last: number | null = null;

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = (now: number) => {
      if (last !== null) seconds += Math.max(0, now - last) / 1000;
      last = now;
      renderer?.draw(seconds);
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      stop();
      if (!renderer || document.hidden) return;
      renderer.draw(seconds);
      if (!motion.matches) {
        last = null;
        frame = requestAnimationFrame(tick);
      }
    };
    const initialize = () => {
      try {
        renderer = createRenderer(canvas);
        canvas.style.visibility = 'visible';
        sync();
      } catch (error) {
        canvas.style.visibility = 'hidden';
        console.warn('Silk background: using the CSS fallback.', error);
      }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      stop();
      renderer?.dispose();
      renderer = null;
      canvas.style.visibility = 'hidden';
    };

    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', initialize);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    const observer = new ResizeObserver(sync);
    observer.observe(canvas);
    initialize();

    return () => {
      stop();
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', initialize);
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
      renderer?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="alt-silk" aria-hidden="true" />;
}
