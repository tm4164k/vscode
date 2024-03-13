"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const fs_1 = require("fs");
const path_1 = require("path");
const TS_CONFIG_PATH = (0, path_1.join)(__dirname, '../../', 'src', 'tsconfig.json');
let hasErrors = false;
function checkFile(program, sourceFile) {
    if (sourceFile.fileName.includes('/test/')) {
        return; // skip over tests
    }
    const checker = program.getTypeChecker();
    checkNode(sourceFile);
    function checkNode(node) {
        if (ts.isCallExpression(node)) {
            const callExpression = node;
            const expression = callExpression.expression;
            if (expression.kind === ts.SyntaxKind.PropertyAccessExpression) {
                return;
            }
            const returnType = checker.getTypeAtLocation(callExpression);
            const disposeMethod = returnType.getProperty('dispose');
            if (disposeMethod && (disposeMethod.flags & ts.SymbolFlags.Method)) {
                const text = node.getText().toLowerCase();
                if (text.includes('register') ||
                    text.includes('dispose') ||
                    text.includes('disposab')) {
                    return;
                }
                const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
                console.log(`${sourceFile.fileName} (${line + 1},${character + 1})`);
            }
        }
        if (node.kind !== ts.SyntaxKind.Identifier) {
            return ts.forEachChild(node, checkNode); // recurse down
        }
    }
}
function createProgram(tsconfigPath) {
    const tsConfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const configHostParser = { fileExists: fs_1.existsSync, readDirectory: ts.sys.readDirectory, readFile: file => (0, fs_1.readFileSync)(file, 'utf8'), useCaseSensitiveFileNames: process.platform === 'linux' };
    const tsConfigParsed = ts.parseJsonConfigFileContent(tsConfig.config, configHostParser, (0, path_1.resolve)((0, path_1.dirname)(tsconfigPath)), { noEmit: true });
    const compilerHost = ts.createCompilerHost(tsConfigParsed.options, true);
    return ts.createProgram(tsConfigParsed.fileNames, tsConfigParsed.options, compilerHost);
}
//
// Create program and start checking
//
const program = createProgram(TS_CONFIG_PATH);
for (const sourceFile of program.getSourceFiles()) {
    checkFile(program, sourceFile);
}
if (hasErrors) {
    process.exit(1);
}
//# sourceMappingURL=missingDisposeChecker.js.map