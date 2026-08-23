const assert = require('assert');
const { parseSections, getSimilarity, matchSections, reassembleDocument } = require('../extension/src/readmeSectionParser');

console.log('Running readmeSectionParser unit tests...');

// 1. Test parseSections
const sampleMarkdown = `
# Project Title
Some description.

## Installation
npm install

## Features
### Subsection H3
Sub content
More H3 details.

## License
MIT
`;

const parsed = parseSections(sampleMarkdown);
assert.strictEqual(parsed.length, 4);
assert.strictEqual(parsed[0].title, 'Overview');
assert.strictEqual(parsed[0].header, '');
assert.strictEqual(parsed[0].content.trim(), '# Project Title\nSome description.');

assert.strictEqual(parsed[1].title, 'Installation');
assert.strictEqual(parsed[1].header, '## Installation');
assert.strictEqual(parsed[1].content.trim(), 'npm install');

assert.strictEqual(parsed[2].title, 'Features');
assert.strictEqual(parsed[2].content.includes('### Subsection H3'), true);

assert.strictEqual(parsed[3].title, 'License');
assert.strictEqual(parsed[3].content.trim(), 'MIT');

console.log('✓ parseSections tests passed.');

// 2. Test getSimilarity
assert.strictEqual(getSimilarity('Features', 'Features'), 1.0);
assert.strictEqual(getSimilarity('Installation', 'Installation Guide'), 0.5);
assert.strictEqual(getSimilarity('Installation Guide', 'Features'), 0.0);
assert.strictEqual(getSimilarity('Key Features', 'Features'), 0.5);

console.log('✓ getSimilarity tests passed.');

// 3. Test matchSections & Fuzzy Greedy Match
const origMD = `
## Installation
npm install

## Features
Core features.

## Contact
Email us.
`;

const genMD = `
## Installation Guide
npm install --save

## Key Features
Fuzzy match features.

## Technologies
Node.js, JS.
`;

const origSections = parseSections(origMD);
const genSections = parseSections(genMD);

const matchResult = matchSections(origSections, genSections);

assert.strictEqual(matchResult.reviewQueue.length, 3);

const installReview = matchResult.reviewQueue.find(r => r.title === 'Installation Guide');
assert.ok(installReview);
assert.strictEqual(installReview.changeType, 'modified');
assert.strictEqual(installReview.originalTitle, 'Installation');

const featuresReview = matchResult.reviewQueue.find(r => r.title === 'Key Features');
assert.ok(featuresReview);
assert.strictEqual(featuresReview.changeType, 'modified');
assert.strictEqual(featuresReview.originalTitle, 'Features');

const techReview = matchResult.reviewQueue.find(r => r.title === 'Technologies');
assert.ok(techReview);
assert.strictEqual(techReview.changeType, 'new');

assert.strictEqual(matchResult.preserved.length, 1);
assert.strictEqual(matchResult.preserved[0].section.title, 'Contact');

console.log('✓ matchSections fuzzy and greedy matching tests passed.');

// 4. Test reassembleDocument
const decisions = new Map();
decisions.set(genSections.findIndex(s => s.title === 'Installation Guide'), 'keep');
decisions.set(genSections.findIndex(s => s.title === 'Key Features'), 'skip');
decisions.set(genSections.findIndex(s => s.title === 'Technologies'), 'keep');

const finalMD = reassembleDocument(origSections, genSections, decisions, matchResult);

const finalSections = parseSections(finalMD);
assert.strictEqual(finalSections.length, 5);

assert.strictEqual(finalSections[1].title, 'Installation Guide');
assert.strictEqual(finalSections[1].content.trim(), 'npm install --save');

assert.strictEqual(finalSections[2].title, 'Features');
assert.strictEqual(finalSections[2].content.trim(), 'Core features.');

assert.strictEqual(finalSections[3].title, 'Contact');
assert.strictEqual(finalSections[3].content.trim(), 'Email us.');

assert.strictEqual(finalSections[4].title, 'Technologies');
assert.strictEqual(finalSections[4].content.trim(), 'Node.js, JS.');

console.log('✓ reassembleDocument order and content checks passed.');

console.log('All readmeSectionParser tests passed successfully!');
