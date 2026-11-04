// Makes a throwaway Sepolia deployer. The key stays in .env, which git ignores, and is never printed.
import { existsSync, appendFileSync, readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
if (existsSync('.env') && readFileSync('.env', 'utf8').includes('DEPLOYER_KEY=')) {
  const key = readFileSync('.env', 'utf8').match(/DEPLOYER_KEY=(0x\w+)/)[1];
  console.log('existing', privateKeyToAccount(key).address);
} else {
  const key = generatePrivateKey();
  appendFileSync('.env', `DEPLOYER_KEY=${key}\n`);
  console.log('new', privateKeyToAccount(key).address);
}
