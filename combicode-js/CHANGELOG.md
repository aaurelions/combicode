# Changelog

## [1.7.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.6.0...combicode-js-v1.7.0) (2025-01-XX)

### Maintenance

- **ci:** migrate to npm trusted publishing (OIDC), remove NPM_TOKEN requirement

## [1.6.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.5.4...combicode-js-v1.6.0) (2025-01-XX)

### Features

- **skip-content:** add `--skip-content` option to include files in tree but omit their content (useful for large test files)

## [1.5.4](https://github.com/aaurelions/combicode/compare/combicode-js-v1.5.3...combicode-js-v1.5.4) (2025-12-03)

### Features

- **ignore:** implement full support for nested `.gitignore` files, ensuring exclusion rules are applied correctly within subdirectories

### Bug Fixes

- **deps:** replace `fast-glob` with `ignore` and recursive directory walking for accurate git-like pattern matching

## [1.5.3](https://github.com/aaurelions/combicode/compare/combicode-js-v1.5.2...combicode-js-v1.5.3) (2025-11-30)

### Bug Fixes

- **cli:** prevent the output file (e.g., `combicode.txt`) from recursively including itself in the generated content

## [1.5.2](https://github.com/aaurelions/combicode/compare/combicode-js-v1.4.0...combicode-js-v1.5.2) (2025-11-30)

### Features

- **tree:** display file sizes in the generated file tree (e.g., `[1.2KB]`)
- **output:** improve file header format (`### **FILE:**`) for better LLM parsing
- **tests:** add integration test suite using native Node.js modules

## [1.4.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.3.0...combicode-js-v1.4.0) (2025-08-13)

### Features

- Add --llms-txt flag for llms.txt documentation context ([0817554](https://github.com/aaurelions/combicode/commit/081755435594b0ca5208609b2724eb47bd73c2dc))

## [1.3.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.2.1...combicode-js-v1.3.0) (2025-06-25)

### Features

- Add package-lock.json for reproducible builds ([06a417a](https://github.com/aaurelions/combicode/commit/06a417a155e9b72e26d0e091d181cfb8c53f0d28))
- **ci:** implement independent package versioning for monorepo ([d02cf23](https://github.com/aaurelions/combicode/commit/d02cf233239c7af8db19061f34b769178334b388))
- improve CLI output and version reporting ([7963a10](https://github.com/aaurelions/combicode/commit/7963a10782c2626608750de53023d37d327d51b2))
- improve CLI output and version reporting ([e74f6d8](https://github.com/aaurelions/combicode/commit/e74f6d8fbed4f9cdf8ad82f3dae87069f66f7bb6))

### Bug Fixes

- **ci:** permission error ([156b76d](https://github.com/aaurelions/combicode/commit/156b76d3ab1550123df2ded6b1da5d6e2e2cc008))
- **npm:** Set public access for publishing and bump version to 1.0.1 ([6c91eb7](https://github.com/aaurelions/combicode/commit/6c91eb714c81ec0201bb0fcfad8ad9fb4124cd7e))
- Use scoped npm package name and bump python version ([8a1b347](https://github.com/aaurelions/combicode/commit/8a1b347f6c54c9762acf354ef289c293d3ef21a3))

## [1.2.0](https://github.com/aaurelions/combicode/compare/combicode-js-v1.1.0...combicode-js-v1.2.0) (2025-06-25)

### Features

- Add package-lock.json for reproducible builds ([06a417a](https://github.com/aaurelions/combicode/commit/06a417a155e9b72e26d0e091d181cfb8c53f0d28))
- **ci:** implement independent package versioning for monorepo ([d02cf23](https://github.com/aaurelions/combicode/commit/d02cf233239c7af8db19061f34b769178334b388))
- improve CLI output and version reporting ([7963a10](https://github.com/aaurelions/combicode/commit/7963a10782c2626608750de53023d37d327d51b2))
- improve CLI output and version reporting ([e74f6d8](https://github.com/aaurelions/combicode/commit/e74f6d8fbed4f9cdf8ad82f3dae87069f66f7bb6))

### Bug Fixes

- **ci:** permission error ([156b76d](https://github.com/aaurelions/combicode/commit/156b76d3ab1550123df2ded6b1da5d6e2e2cc008))
- **npm:** Set public access for publishing and bump version to 1.0.1 ([6c91eb7](https://github.com/aaurelions/combicode/commit/6c91eb714c81ec0201bb0fcfad8ad9fb4124cd7e))
- Use scoped npm package name and bump python version ([8a1b347](https://github.com/aaurelions/combicode/commit/8a1b347f6c54c9762acf354ef289c293d3ef21a3))
