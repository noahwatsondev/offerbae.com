const fs = require('fs');
const path = require('path');

const filesToDelete = [
    'views/home.ejs',
    'views/index.ejs',
    'views/brand.ejs',
    'views/product.ejs',
    'views/catalog.ejs',
    'views/offers.ejs',
    'views/products.ejs',
    'views/coming-soon.ejs',
    'views/partials/header.ejs',
    'views/partials/footer.ejs',
    'views/partials/header-styles.ejs',
    'views/partials/nav-scripts.ejs',
    'src/controllers/productController.js'
];

filesToDelete.forEach(f => {
    if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        console.log('Deleted: ' + f);
    }
});

if (fs.existsSync('archive')) {
    fs.rmSync('archive', { recursive: true, force: true });
    console.log('Deleted: archive/');
}

// Now rename fresh files
function walkDir(dir, callback) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory && !['node_modules', '.git', 'public/uploads'].includes(f)) {
            walkDir(dirPath, callback);
        } else if (!isDirectory) {
            callback(dirPath);
        }
    });
}

// 1. Rename files in views
if (fs.existsSync('views')) {
    fs.readdirSync('views').forEach(f => {
        if (f.startsWith('fresh-') && f.endsWith('.ejs')) {
            fs.renameSync(path.join('views', f), path.join('views', f.replace('fresh-', '')));
            console.log(`Renamed views/${f} -> views/${f.replace('fresh-', '')}`);
        }
    });
}

// 2. Rename files in views/partials
if (fs.existsSync('views/partials')) {
    fs.readdirSync('views/partials').forEach(f => {
        if (f.startsWith('fresh-') && f.endsWith('.ejs')) {
            let newName = f.replace('fresh-', '');
            if (newName === 'main.ejs') newName = 'main-container.ejs';
            fs.renameSync(path.join('views/partials', f), path.join('views/partials', newName));
            console.log(`Renamed views/partials/${f} -> views/partials/${newName}`);
        }
    });
}

// 3. Rename public files
if (fs.existsSync('public/js')) {
    fs.readdirSync('public/js').forEach(f => {
        if (f.startsWith('fresh-') && f.endsWith('.js')) {
            fs.renameSync(path.join('public/js', f), path.join('public/js', f.replace('fresh-', '')));
            console.log(`Renamed public/js/${f} -> public/js/${f.replace('fresh-', '')}`);
        }
    });
}
if (fs.existsSync('public/css/fresh')) {
    fs.renameSync('public/css/fresh', 'public/css/layout');
    console.log(`Renamed public/css/fresh -> public/css/layout`);
}

// 4. Rename scss directory
if (fs.existsSync('src/scss/fresh')) {
    fs.renameSync('src/scss/fresh', 'src/scss/layout');
    console.log(`Renamed src/scss/fresh -> src/scss/layout`);
}

// 5. Global replace in source files
const dirsToWalk = ['views', 'src', 'public/js', '.'];
dirsToWalk.forEach(d => {
    if (d === '.') {
        // Just process package.json in root
        if (fs.existsSync('package.json')) {
            let content = fs.readFileSync('package.json', 'utf8');
            let originalContent = content;
            content = content.replace(/fresh\/main\.scss/g, 'layout/main.scss');
            content = content.replace(/fresh\/main\.css/g, 'layout/main.css');
            if (content !== originalContent) {
                fs.writeFileSync('package.json', content);
                console.log(`Updated contents of package.json`);
            }
        }
        return;
    }

    walkDir(d, (filePath) => {
        if (filePath.endsWith('.ejs') || filePath.endsWith('.scss') || filePath.endsWith('.js')) {
            let content = fs.readFileSync(filePath, 'utf8');
            let originalContent = content;

            content = content.replace(/\/css\/fresh\//g, '/css/layout/');
            content = content.replace(/\/api\/fresh\//g, '/api/');
            content = content.replace(/fresh-main/g, 'main-container');

            // BE CAREFUL WITH GLOBAL REPLACEMENTS on fresh- and fresh_
            content = content.replace(/fresh-/g, '');
            content = content.replace(/fresh_/g, '');
            content = content.replace(/fresh\//g, '/');

            if (content !== originalContent) {
                fs.writeFileSync(filePath, content);
                console.log(`Updated contents of ${filePath}`);
            }
        }
    });
});

console.log('Cleanup and migration script complete.');
