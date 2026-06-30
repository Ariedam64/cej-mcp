import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMCPServer } from './server.js';

const GIT_REPOS = [
  'C:/Users/Romann/Desktop/Codage/magicGarden - Copie',
  'C:/Users/Romann/Desktop/Codage/mgafk-android',
  'F:/FridaIL2CPPToolkit',
  'C:/Users/Romann/Desktop/Codage/cej',
];

const server = createMCPServer(GIT_REPOS);
const transport = new StdioServerTransport();
await server.connect(transport);
