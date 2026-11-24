// Manage agent accounts from the command line.
//
//   npm run agent -- add <name>        create an account and print a generated password once
//   npm run agent -- reset <name>      new generated password; signs the agent out everywhere
//   npm run agent -- disable <name>    block login (history and assignments are kept)
//   npm run agent -- enable <name>
//   npm run agent -- list
//
// The password is generated, not typed on the command line, so it never lands in shell history.
// To choose one yourself, set AGENT_PASSWORD in the environment for that one command.
//
// With the embedded database (PGlite, the default), stop the API server first: only one
// process may open the database folder at a time. With DATABASE_URL (Postgres) that's not needed.
import { initDb } from '../src/db.js';
import { config } from '../src/config.js';
import { createAgent, generatePassword, listAgents, setAgentActive, setPassword } from '../src/auth.js';

const [command, ...rest] = process.argv.slice(2);
const name = rest.join(' ').trim();

function usage() {
  console.log('Usage: npm run agent -- <add|reset|disable|enable|list> [name]');
  process.exit(1);
}

if (!command) usage();
if (!config.databaseUrl) {
  console.log('(Embedded database: make sure the API server is stopped.)');
}
const db = await initDb();
try {
  const password = process.env.AGENT_PASSWORD || generatePassword();
  if (command === 'add' && name) {
    await createAgent(name, password);
    console.log(`Created agent "${name}".`);
    if (!process.env.AGENT_PASSWORD) console.log(`Password (shown once, share it privately): ${password}`);
  } else if (command === 'reset' && name) {
    await setPassword(name, password);
    console.log(`New password set for "${name}"; their open sessions were signed out.`);
    if (!process.env.AGENT_PASSWORD) console.log(`Password (shown once): ${password}`);
  } else if ((command === 'disable' || command === 'enable') && name) {
    await setAgentActive(name, command === 'enable');
    console.log(`Agent "${name}" ${command}d.`);
  } else if (command === 'list') {
    const agents = await listAgents();
    if (!agents.length) console.log('No agents yet. Add one with: npm run agent -- add <name>');
    for (const a of agents) console.log(`${a.active ? 'active  ' : 'disabled'}  ${a.name}`);
  } else {
    usage();
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
