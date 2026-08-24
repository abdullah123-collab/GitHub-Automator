const vscode = require('vscode');
let context = null;

function initCredentialManager(ctx) {
  context = ctx;
}

async function getGeminiApiKey({ promptIfMissing = true } = {}) {
  if (!context) {
    throw new Error('Credential Manager not initialized.');
  }
  const storedKey = await context.secrets.get('geminiApiKey');
  if (storedKey) {
    return { source: 'secret', apiKey: storedKey };
  }
  if (!promptIfMissing) {
    return { source: 'fallback', apiKey: null };
  }
  const choice = await vscode.window.showInformationMessage(
    "Gemini API key is not configured. Would you like to set it up or use the local fallback?",
    "Configure Key", "Use Local Fallback"
  );
  if (choice === "Configure Key") {
    await configureGeminiApiKey();
    const key = await context.secrets.get('geminiApiKey');
    return key ? { source: 'secret', apiKey: key } : { source: 'cancel', apiKey: null };
  }
  if (choice === "Use Local Fallback") {
    return { source: 'fallback', apiKey: null };
  }
  return { source: 'cancel', apiKey: null };
}

async function configureGeminiApiKey() {
  if (!context) return;
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your Gemini API Key (e.g. AIzaSy...)',
    placeHolder: 'API Key',
    ignoreFocusOut: true,
    password: true
  });
  if (key && key.trim()) {
    await context.secrets.store('geminiApiKey', key.trim());
    vscode.window.showInformationMessage('Gemini API Key configured successfully.');
  }
}

async function removeGeminiApiKey() {
  if (!context) return;
  await context.secrets.delete('geminiApiKey');
  vscode.window.showInformationMessage('Gemini API Key removed.');
}

module.exports = {
  initCredentialManager,
  getGeminiApiKey,
  configureGeminiApiKey,
  removeGeminiApiKey
};
