const fs = require('fs');
const path = require('path');

function copyFolderSync(from, to) {
    if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
    }

    const items = fs.readdirSync(from, { withFileTypes: true });

    for (const item of items) {
        const srcPath = path.join(from, item.name);
        const destPath = path.join(to, item.name);

        if (item.name === '__pycache__' || item.name.endsWith('.pyc') || item.name === 'venv') {
            continue;
        }

        if (item.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

const rootBackend = path.join(__dirname, '..', '..', 'backend');
const extBackend = path.join(__dirname, '..', 'backend');

console.log('Copying backend folder to extension/backend...');
if (fs.existsSync(rootBackend)) {
    copyFolderSync(rootBackend, extBackend);
    console.log('Backend copied successfully.');
} else {
    console.warn('Root backend folder not found. Skipping copy.');
}
