const path = require('node:path');
const { generateIssue816Fixtures } = require('./issue816-fixtures.cjs');

const baseDirectory =
  process.env.PANDA_STAGE_ISSUE816_ROOT ??
  'D:\\PandaStage-Acceptance\\issue816-dl01';

generateIssue816Fixtures(path.resolve(baseDirectory))
  .then(({ root }) => {
    console.log('Generated #816 F01/F05/F06 fixtures:', root);
  })
  .catch((error) => {
    console.error(error.stack ?? error);
    process.exitCode = 1;
  });
