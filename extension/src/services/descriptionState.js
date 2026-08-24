// extension/src/services/descriptionState.js
// Description editor state machine for repository description editing

const vscode = require('vscode');
const { runBackendScript } = require('../pythonBridge');
const { log } = require('../utils');

class DescriptionEditor {
  constructor(repoName, owner, element) {
    this.repoName = repoName;
    this.owner = owner;
    this.element = element; // DOM element where editing UI is injected
    this.state = 'idle'; // idle | editing | generating | saving | saved | error
    this.dirty = false;
    this.prevValue = '';
    this.input = null; // textarea element
    this.button = null; // generate button
    this.progressContainer = null;
    this.statusText = null;
  }

  async start() {
    if (this.state !== 'idle') return;
    this.state = 'editing';
    const currentDesc = this.element.innerText === 'No description provided.' ? '' : this.element.innerText;
    this.prevValue = currentDesc;
    this.element.ondblclick = null;
    // replace element content with editing UI
    this.element.innerHTML = `
      <div style="display: flex; flex-direction: column; width: 100%; box-sizing: border-box; cursor: default;">
        <div style="display: flex; gap: 4px; align-items: flex-start; width: 100%; box-sizing: border-box;">
          <textarea class="desc-edit-input" style="flex: 1; box-sizing: border-box; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-focusBorder); outline: none; border-radius: 2px; min-height: 24px; max-height: 120px; resize: vertical; font-family: inherit; font-size: 12px; font-style: normal; width: 100%; min-width: 0; height: auto;">
            ${currentDesc.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
          </textarea>
          <button title="✨ Auto Generate Description" style="background: transparent; border: none; cursor: pointer; padding: 4px; color: var(--vscode-icon-foreground); display: flex; align-items: center; justify-content: center; margin-top: 2px; flex-shrink: 0; width: auto;">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.158 13.844L12.784 5.22l-.707-.707-8.625 8.624.706.707zm7.575-8.544l2.122 2.122 1.414-1.414-2.121-2.122-1.415 1.414zM1.5 15.5l1.414 1.414 2.121-2.121L3.62 12.67 1.5 14.793v.707zM11 2.5a.5.5 0 0 1 .5-.5h2V0h1v2h2v1h-2v2h-1V3h-2a.5.5 0 0 1-.5-.5zm-4-1a.5.5 0 0 1 .5-.5h1V0h1v1h1v1H9v1H8V2H7a.5.5 0 0 1-.5-.5z"/></svg>
          </button>
        </div>
        <div class="desc-progress-container" style="height: 3px; width: 100%; background: var(--vscode-input-background, #1e1e1e); overflow: hidden; position: relative; border-radius: 2px; margin-top: 4px; display: none;">
          <div class="desc-progress-line"></div>
        </div>
        <div class="desc-status-text" style="font-size: 11px; margin-top: 4px; min-height: 14px; display: none;"></div>
      </div>`;
    this.input = this.element.querySelector('textarea');
    this.button = this.element.querySelector('button');
    this.progressContainer = this.element.querySelector('.desc-progress-container');
    this.statusText = this.element.querySelector('.desc-status-text');
    this.input.focus();
    this._attachHandlers();
  }

  _attachHandlers() {
    // generate button click
    this.button.addEventListener('click', async () => {
      if (this.state === 'generating' || this.state === 'saving') return;
      await this._generateDescription();
    });
    // Escape key handling – prompt if dirty
    this.input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        await this._handleCloseAttempt();
      }
    });
    // No onblur auto‑cancel – keep editor open
  }

  async _generateDescription() {
    this._setState('generating');
    try {
      const generated = await runBackendScript('services/ai_description_cli.py', {
        model: vscode.workspace.getConfiguration('github-automator').get('geminiModel', 'gemini-3.6-flash')
      });
      if (!generated || !generated.success) {
        const err = generated && generated.error ? generated.error : 'AI generation failed.';
        await vscode.window.showErrorMessage(err);
        this._setState('error');
        return;
      }
      this.input.value = generated.description || '';
      this.dirty = true;
      this._setState('generated/review');
    } catch (e) {
      await vscode.window.showErrorMessage(e && e.message ? e.message : String(e));
      this._setState('error');
    }
  }

  _setState(newState) {
    this.state = newState;
    switch (newState) {
      case 'generating':
        this.input.disabled = true;
        this.progressContainer.style.display = 'block';
        this.statusText.style.display = 'block';
        this.statusText.className = 'desc-status-text';
        this.statusText.innerText = 'Generating description...';
        this.statusText.style.color = 'var(--vscode-descriptionForeground)';
        this.button.innerHTML = '<span class="loading" style="width: 14px; height: 14px; display: inline-block; border-radius: 50%;"></span>';
        break;
      case 'generated/review':
        this.input.disabled = false;
        this.progressContainer.style.display = 'none';
        this.statusText.style.display = 'block';
        this.statusText.className = 'desc-status-text modified';
        this.statusText.innerText = 'Description has been modified';
        this.statusText.style.color = 'var(--vscode-progressBar-background, #007fd4)';
        this.button.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.158 13.844L12.784 5.22l-.707-.707-8.625 8.624.706.707zm7.575-8.544l2.122 2.122 1.414-1.414-2.121-2.122-1.415 1.414zM1.5 15.5l1.414 1.414 2.121-2.121L3.62 12.67 1.5 14.793v.707zM11 2.5a.5.5 0 0 1 .5-.5h2V0h1v2h2v1h-2v2h-1V3h-2a.5.5 0 0 1-.5-.5zm-4-1a.5.5 0 0 1 .5-.5h1V0h1v1h1v1H9v1H8V2H7a.5.5 0 0 1-.5-.5z"/></svg>`;
        this.input.focus();
        break;
      case 'saving':
        this.input.disabled = true;
        this.progressContainer.style.display = 'none';
        this.statusText.style.display = 'block';
        this.statusText.className = 'desc-status-text saving';
        this.statusText.innerText = 'Saving...';
        break;
      case 'saved':
        this.input.disabled = true;
        this.progressContainer.style.display = 'none';
        this.statusText.style.display = 'none';
        this.dirty = false;
        break;
      case 'error':
        this.input.disabled = false;
        this.progressContainer.style.display = 'none';
        this.statusText.style.display = 'block';
        this.statusText.className = 'desc-status-text error';
        this.statusText.innerText = 'Error';
        this.statusText.style.color = 'var(--vscode-errorForeground)';
        break;
    }
  }

  async _handleCloseAttempt() {
    if (!this.dirty) {
      this.cancel();
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      'Unsaved description changes detected.',
      { modal: true },
      'Save',
      'Discard',
      'Cancel'
    );
    if (choice === 'Save') {
      await this.save();
    } else if (choice === 'Discard') {
      this.cancel();
    } // else Cancel – keep editor open
  }

  async save() {
    this._setState('saving');
    try {
      const desc = this.input.value.trim();
      const result = await runBackendScript('managers/repo_manager.py', {
        action: 'update_description',
        repo_name: this.repoName,
        owner: this.owner,
        description: desc
      });
      if (!result || !result.success) {
        throw new Error(result && result.message ? result.message : 'Failed to update description');
      }
      this.element.innerHTML = desc || 'No description provided.';
      this._setState('saved');
    } catch (e) {
      await vscode.window.showErrorMessage(`Error updating description: ${e && e.message ? e.message : e}`);
      this._setState('error');
    } finally {
      this._cleanup();
    }
  }

  cancel() {
    this.element.innerHTML = this.prevValue || 'No description provided.';
    this._cleanup();
  }

  _cleanup() {
    this.state = 'idle';
    this.dirty = false;
    this.element.ondblclick = (e) => {
      if (global.editDescription) global.editDescription(this.repoName, this.owner, this.element);
    };
  }
}

// Handle backend messages for generated description
  async handleGenerated(payload) {
    if (!payload) return;
    if (payload.success) {
      this.input.value = payload.description || '';
      this.dirty = true;
    }
    this._setState('generated/review');
  }

  // Handle backend messages for description update result
  async handleUpdated(payload) {
    if (!payload) return;
    if (payload.success) {
      this.element.innerHTML = payload.description || 'No description provided.';
      this._setState('saved');
    } else {
      // revert to previous value and show error
      this.element.innerHTML = this.prevValue || 'No description provided.';
      await vscode.window.showErrorMessage(payload.error || 'Failed to update description');
      this._setState('error');
    }
    this._cleanup();
  }

module.exports = { DescriptionEditor };
