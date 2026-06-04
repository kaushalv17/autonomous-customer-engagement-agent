import chalk from 'chalk';

const timestamp = () => new Date().toISOString().split('T')[1].split('.')[0];

export const logger = {
  info: (msg: string) => console.log(chalk.blue(`[${timestamp()}] INFO  ${msg}`)),
  success: (msg: string) => console.log(chalk.green(`[${timestamp()}] OK    ${msg}`)),
  warn: (msg: string) => console.log(chalk.yellow(`[${timestamp()}] WARN  ${msg}`)),
  error: (msg: string) => console.log(chalk.red(`[${timestamp()}] ERR   ${msg}`)),
  agent: (msg: string) => console.log(chalk.magenta(`[${timestamp()}] AGENT ${msg}`)),
  dim: (msg: string) => console.log(chalk.gray(`[${timestamp()}]       ${msg}`)),
};
