/* bun run dev — api + worker + web параллельно, с префиксами в выводе; Ctrl+C останавливает все процессы. */
const apps = [
  { name: 'api', color: '\x1b[36m', cmd: ['bun', 'run', '--cwd', 'apps/api', 'dev'] },
  { name: 'worker', color: '\x1b[35m', cmd: ['bun', 'run', '--cwd', 'apps/worker', 'dev'] },
  { name: 'web', color: '\x1b[33m', cmd: ['bun', 'run', '--cwd', 'apps/web', 'dev'] },
];

const procs = apps.map(a => {
  const p = Bun.spawn(a.cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const pipe = async (stream: ReadableStream<Uint8Array>, out: NodeJS.WriteStream) => {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of stream) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) out.write(`${a.color}[${a.name}]\x1b[0m ${l}\n`);
    }
  };
  void pipe(p.stdout, process.stdout);
  void pipe(p.stderr, process.stderr);
  return p;
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// если один из процессов упал — останавливаем остальные
await Promise.race(procs.map(p => p.exited));
stop();
await Promise.all(procs.map(p => p.exited));
