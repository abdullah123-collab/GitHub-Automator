const path = require('path');
const { runPythonScript } = require('../pythonBridge');
const { getGeminiApiKey } = require('./credentialManager');

let logFn = console.log;

function initAiClient(log) {
  if (log) {
    logFn = log;
  }
}

class CancellationError extends Error {
  constructor() {
    super('Operation cancelled by user');
    this.name = 'CancellationError';
  }
}

/**
 * Shared method to call python AI scripts.
 * @param {string} scriptPath Relative path to backend (e.g. 'services/ai_commit_cli.py')
 * @param {object} payload Additional payload parameters
 * @param {string} backendRoot Absolute path to backend directory
 * @param {boolean} promptIfMissing Whether to prompt for key if missing
 */
async function callAiService(scriptPath, payload, backendRoot, promptIfMissing = true) {
  // 1. Get API Key & Mode
  const credResult = await getGeminiApiKey({ promptIfMissing });
  
  if (credResult.source === 'cancel') {
    throw new CancellationError();
  }
  
  const apiKey = credResult.apiKey;
  const aiMode = credResult.source === 'secret' ? 'gemini' : 'fallback';
  
  // 2. Prepare payload
  const fullPayload = {
    ...payload,
    api_key: apiKey,
    ai_mode: aiMode
  };
  
  // 3. Log metadata only (NO api keys, NO full payload logging)
  const fullScriptPath = path.join(backendRoot, scriptPath);
  logFn(`[AI CLIENT] Invoking AI Service: ${scriptPath} | mode=${aiMode} | apiKeyProvided=${Boolean(apiKey)} | payloadSize=${JSON.stringify(payload).length}`);
  
  try {
    const response = await runPythonScript(fullScriptPath, fullPayload, backendRoot);
    
    // 4. Validate unified result envelope
    if (response && response.success) {
      return {
        success: true,
        content: response.content
      };
    } else {
      const err = (response && response.error) || {};
      return {
        success: false,
        error: {
          code: err.code || 'UNKNOWN',
          message: err.message || 'AI invocation failed.',
          details: err.details || 'No additional details provided.',
          fallback: err.fallback || { available: false, content: null }
        }
      };
    }
  } catch (error) {
    logFn(`[AI CLIENT] Process invocation failed: ${error.message}`);
    return {
      success: false,
      error: {
        code: 'UNKNOWN',
        message: 'AI Service execution failed.',
        details: error.stack || error.message,
        fallback: { available: false, content: null }
      }
    };
  }
}

module.exports = {
  initAiClient,
  callAiService,
  CancellationError
};
