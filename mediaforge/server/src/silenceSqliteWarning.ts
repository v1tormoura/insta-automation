// node:sqlite ainda emite ExperimentalWarning no Node 22; os demais avisos seguem normais.
const originalEmit = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (/SQLite is an experimental feature/i.test(text)) return;
  return (originalEmit as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

export {};
