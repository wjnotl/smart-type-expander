#!/usr/bin/env node
import ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

// Command Line Arguments
const args = process.argv.slice(2);
const fileArg = args[0];
const typeArg = args[1];

if (!fileArg || !typeArg) {
  console.error('\x1b[31mError: Missing arguments.\x1b[0m');
  console.log('\n\x1b[36mUsage:\x1b[0m');
  console.log('  npx smart-type-expander <path-to-file> <type-name>');
  process.exit(1);
}

const TARGET_FILE = path.resolve(process.cwd(), fileArg);
const TARGET_TYPE = typeArg;

if (!fs.existsSync(TARGET_FILE)) {
  console.error(`\x1b[31mError: Target file does not exist at "${TARGET_FILE}"\x1b[0m`);
  process.exit(1);
}

function expandType() {
  // Load target project's tsconfig.json dynamically to resolve external types
  const targetProjectDir = path.dirname(TARGET_FILE);
  const configPath = ts.findConfigFile(targetProjectDir, ts.sys.fileExists, 'tsconfig.json');

  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
  };

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
    );
    compilerOptions = parsedConfig.options;
  }

  const program = ts.createProgram([TARGET_FILE], compilerOptions);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(TARGET_FILE);

  if (!sourceFile) {
    console.error(`\x1b[31mError: Could not parse source file: ${TARGET_FILE}\x1b[0m`);
    process.exit(1);
  }

  let targetTypeObj: ts.Type | undefined;

  // Structural AST crawl to find targeted interface or type alias
  sourceFile.forEachChild(function findNode(node: ts.Node) {
    if (targetTypeObj) return;
    if (
      (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      node.name.text === TARGET_TYPE
    ) {
      targetTypeObj = checker.getTypeAtLocation(node);
    }
    node.forEachChild(findNode);
  });

  if (!targetTypeObj) {
    console.error(
      `\x1b[31mError: Could not find type or interface named "${TARGET_TYPE}" in ${fileArg}\x1b[0m`,
    );
    process.exit(1);
    return;
  }

  // Structural Auto-Detection Heuristic Rule
  function shouldSkipExpansion(type: ts.Type, typeName: string): boolean {
    if (
      typeName === 'any' ||
      typeName === 'string' ||
      typeName === 'number' ||
      typeName === 'boolean'
    ) {
      return true;
    }

    const flags = type.getFlags();
    if (
      flags &
      (ts.TypeFlags.String |
        ts.TypeFlags.Number |
        ts.TypeFlags.Boolean |
        ts.TypeFlags.StringLiteral |
        ts.TypeFlags.NumberLiteral)
    ) {
      return true;
    }

    if (typeName.startsWith('$Enums.') || typeName.startsWith('$')) return true;

    const symbol = type.getSymbol() || type.aliasSymbol;
    if (symbol) {
      const declarations = symbol.getDeclarations();
      if (declarations && declarations.length > 0) {
        const sourceFileName = declarations[0].getSourceFile().fileName;
        if (
          sourceFileName.includes('node_modules/typescript/lib/lib.') ||
          sourceFileName.includes('node_modules/@types/node')
        ) {
          return true;
        }
      }
    }

    if (flags & ts.TypeFlags.Object) {
      const objectFlags = (type as ts.ObjectType).objectFlags;
      if (objectFlags & ts.ObjectFlags.Class) return true;
      if (objectFlags & ts.ObjectFlags.Reference) {
        return !checker.isArrayType(type);
      }
    }

    return false;
  }

  // Recursive Object Properties Serializer
  function serializeType(type: ts.Type, visited = new Set<ts.Type>()): string {
    if (visited.has(type)) return '[Circular]';
    visited.add(type);

    if (checker.isArrayType(type)) {
      const typeArgs = (type as ts.TypeReference).typeArguments;
      const elementType = typeArgs ? typeArgs[0] : undefined;

      if (elementType) {
        const isUnion = elementType.isUnion();
        const elementStr = serializeType(elementType, new Set(visited));

        if (elementStr.includes('\n') || isUnion) {
          return isUnion ? `(\n${elementStr}\n)[]` : `${elementStr}[]`;
        }
        return `${elementStr}[]`;
      }
      return 'any[]';
    }

    const typeName = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);

    if (shouldSkipExpansion(type, typeName)) {
      return typeName;
    }

    if (type.isUnion()) {
      return type.types.map((t) => serializeType(t, new Set(visited))).join(' | ');
    }

    if (type.isIntersection()) {
      return type.types.map((t) => serializeType(t, new Set(visited))).join(' & ');
    }

    if (type.getFlags() & ts.TypeFlags.Object || type.getProperties().length > 0) {
      const properties = type.getProperties();
      if (properties.length === 0) return typeName;

      let result = '{\n';
      for (const prop of properties) {
        const propName = prop.getName();
        const propType = checker.getTypeOfSymbolAtLocation(prop, sourceFile!);

        const isOptional = (prop.getFlags() & ts.SymbolFlags.Optional) !== 0;
        const formattedName = isOptional ? `${propName}?` : propName;

        const val = serializeType(propType, new Set(visited));
        result += `${formattedName}: ${val};\n`;
      }
      result += '}';
      return result;
    }

    return typeName;
  }

  // Prettier-Style Indentation Post-Processor
  function formatOutput(rawString: string): string {
    const lines = rawString.split('\n');
    let currentIndent = 0;
    const indentWidth = 2;

    return lines
      .map((line) => {
        let trimmed = line.trim();
        if (!trimmed) return '';

        // Adjust indent backwards if the line CLOSES a structure block
        const closingBrackets = (trimmed.match(/[}\)\]]/g) || []).length;
        const openingBrackets = (trimmed.match(/[{(\[]/g) || []).length;

        // Net change calculation for line evaluation positioning
        if (closingBrackets > openingBrackets) {
          currentIndent = Math.max(0, currentIndent - (closingBrackets - openingBrackets));
        }

        const spaces = ' '.repeat(currentIndent * indentWidth);
        const formattedLine = `${spaces}${trimmed}`;

        // Adjust indent forward if the line OPENS a new nested block scope
        if (openingBrackets > closingBrackets) {
          currentIndent += openingBrackets - closingBrackets;
        }

        return formattedLine;
      })
      .join('\n');
  }

  // Output Final Safe Stream
  const rawStructure = serializeType(targetTypeObj as ts.Type);
  const prettyStructure = formatOutput(`type ${TARGET_TYPE} = ${rawStructure};`);

  console.log(`\n\x1b[32m=== Expanded Structural Definition for ${TARGET_TYPE} ===\x1b[0m\n`);
  console.log(`${prettyStructure}\n`);
}

expandType();
