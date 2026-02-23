const fs = require('fs');
const glob = require('glob');

const files = glob.sync('convex/**/*.ts');
let missingCount = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const regex = /export const \w+ = (query|mutation|action|internalQuery|internalMutation|internalAction)\(\s*\{([\s\S]*?handler:)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (!match[2].includes('returns:')) {
      console.log(`Missing returns: in ${file} at match: ${match[0].split('\n')[0]}`);
      missingCount++;
    }
  }
}
console.log(`Total missing returns: ${missingCount}`);
