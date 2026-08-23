function parseSections(markdown) {
  const sections = [];
  const lines = markdown.split(/\r?\n/);
  
  let currentTitle = "Overview";
  let currentHeader = "";
  let currentLines = [];
  let startLine = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      // Save current section
      sections.push({
        title: currentTitle,
        header: currentHeader,
        content: currentLines.join('\n'),
        startLine: startLine,
        endLine: i // 1-indexed, end of previous line is i
      });
      
      // Start new section
      currentTitle = line.substring(3).trim();
      currentHeader = line;
      currentLines = [];
      startLine = i + 1;
    } else {
      currentLines.push(line);
    }
  }
  
  // Save final section
  sections.push({
    title: currentTitle,
    header: currentHeader,
    content: currentLines.join('\n'),
    startLine: startLine,
    endLine: lines.length
  });
  
  return sections;
}

function getSimilarity(s1, s2) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const words = s => new Set(norm(s).split(/\s+/).filter(Boolean));
  
  const w1 = words(s1);
  const w2 = words(s2);
  
  if (w1.size === 0 || w2.size === 0) return 0;
  
  let intersection = 0;
  w1.forEach(w => {
    if (w2.has(w)) intersection++;
  });
  
  const union = w1.size + w2.size - intersection;
  return intersection / union;
}

function matchSections(originalSections, generatedSections) {
  // 1. Calculate similarity pairs between original and generated sections
  const pairs = [];
  for (let i = 0; i < originalSections.length; i++) {
    for (let j = 0; j < generatedSections.length; j++) {
      const orig = originalSections[i];
      const gen = generatedSections[j];
      
      const sim = getSimilarity(orig.title, gen.title);
      if (sim >= 0.5) {
        pairs.push({ origIdx: i, genIdx: j, similarity: sim });
      }
    }
  }
  
  // 2. Sort pairs by similarity descending
  pairs.sort((a, b) => b.similarity - a.similarity);
  
  // 3. One-to-one greedy assignment
  const origMatched = new Set();
  const genMatched = new Set();
  
  const origToGen = new Map();
  const genToOrig = new Map();
  
  pairs.forEach(pair => {
    if (!origMatched.has(pair.origIdx) && !genMatched.has(pair.genIdx)) {
      origMatched.add(pair.origIdx);
      genMatched.add(pair.genIdx);
      origToGen.set(pair.origIdx, pair.genIdx);
      genToOrig.set(pair.genIdx, pair.origIdx);
    }
  });
  
  // 4. Classify sections
  const reviewQueue = [];
  const matchedGenIndices = new Set();
  
  for (let j = 0; j < generatedSections.length; j++) {
    const gen = generatedSections[j];
    const origIdx = genToOrig.get(j);
    
    if (origIdx !== undefined) {
      const orig = originalSections[origIdx];
      matchedGenIndices.add(j);
      
      const isChanged = orig.content.trim() !== gen.content.trim() || orig.title !== gen.title;
      
      if (isChanged) {
        reviewQueue.push({
          changeType: 'modified',
          title: gen.title,
          originalTitle: orig.title,
          heading: gen.header,
          originalHeading: orig.header,
          oldContent: orig.content,
          newContent: gen.content,
          genIdx: j,
          origIdx: origIdx
        });
      }
    } else {
      // New section
      reviewQueue.push({
        changeType: 'new',
        title: gen.title,
        heading: gen.header,
        oldContent: '',
        newContent: gen.content,
        genIdx: j,
        origIdx: -1
      });
    }
  }
  
  // Find preserved original sections (omitted by AI)
  const preserved = [];
  for (let i = 0; i < originalSections.length; i++) {
    if (!origMatched.has(i)) {
      preserved.push({
        origIdx: i,
        section: originalSections[i]
      });
    }
  }
  
  return {
    reviewQueue,
    preserved,
    origToGen,
    genToOrig
  };
}

function reassembleDocument(originalSections, generatedSections, decisions, matchResult) {
  const { preserved, genToOrig } = matchResult;
  
  // 1. Build anchoring for preserved sections
  const anchorMap = new Map(); // genIdx (or "START") -> array of preserved sections
  
  // Sort preserved sections by original index to maintain order
  const sortedPreserved = [...preserved].sort((a, b) => a.origIdx - b.origIdx);
  
  sortedPreserved.forEach(p => {
    // Find closest preceding matched section in original
    let anchor = "START";
    for (let i = p.origIdx - 1; i >= 0; i--) {
      const genIdx = matchResult.origToGen.get(i);
      if (genIdx !== undefined) {
        anchor = genIdx;
        break;
      }
    }
    
    if (!anchorMap.has(anchor)) {
      anchorMap.set(anchor, []);
    }
    anchorMap.get(anchor).push(p.section);
  });
  
  const outputParts = [];
  
  const appendSection = (sec) => {
    let sectionText = '';
    if (sec.header) {
      sectionText = sec.header + '\n' + sec.content;
    } else {
      sectionText = sec.content;
    }
    outputParts.push(sectionText);
  };
  
  // Output START anchored sections
  if (anchorMap.has("START")) {
    anchorMap.get("START").forEach(appendSection);
  }
  
  // Output generated sections in order
  for (let j = 0; j < generatedSections.length; j++) {
    const gen = generatedSections[j];
    const decision = decisions.get(j); // 'keep' or 'skip' (if not decided, skipped by default)
    
    const origIdx = genToOrig.get(j);
    const isNew = origIdx === undefined;
    
    let shouldOutput = false;
    let secToOutput = null;
    
    if (isNew) {
      if (decision === 'keep') {
        shouldOutput = true;
        secToOutput = gen;
      }
    } else {
      shouldOutput = true;
      const orig = originalSections[origIdx];
      if (decision === 'keep') {
        secToOutput = gen;
      } else {
        secToOutput = orig;
      }
    }
    
    if (shouldOutput && secToOutput) {
      appendSection(secToOutput);
    }
    
    // Output sections anchored to this gen index
    if (anchorMap.has(j)) {
      anchorMap.get(j).forEach(appendSection);
    }
  }
  
  return outputParts.join('\n');
}

module.exports = {
  parseSections,
  getSimilarity,
  matchSections,
  reassembleDocument
};
