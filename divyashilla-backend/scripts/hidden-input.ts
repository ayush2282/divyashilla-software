import { emitKeypressEvents } from 'node:readline';

export function hiddenInput(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use an interactive terminal for password entry.');
  return new Promise((resolve,reject) => {
    let value = '';
    process.stdout.write(label);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => {
      process.stdin.removeListener('keypress',onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (text: string | undefined,key: {name?: string; ctrl?: boolean; sequence?: string}) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Cancelled.')); }
      else if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = Array.from(value).slice(0,-1).join('');
      else if (!key.ctrl && text && !/[\u0000-\u001f\u007f]/.test(text)) value += text;
    };
    process.stdin.on('keypress',onKey);
  });
}
