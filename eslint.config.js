import js from "@eslint/js";
import globals from "globals";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import {defineConfig} from "eslint/config";

export default defineConfig([
    {
        ignores: [
            "**/node_modules/**", "**/dist/**", "**/.wrangler/**",
            "release/**", "enquote-release-v102/**", ".run-localappdata/**",
            "_build-logs/**", "_script-output/**", "_calm-warning-backups/**",
            "_mangled-char-fix-backups/**",
            "enquote-full-sync-v3/**", "enquote-snapshot-fix/**",
            "enquote-web-adapter/**", "enquote-web-auth/**",
            "enquote-sync-worker/enquote-ai-handoff/**",
            "enquote-sync-worker/enquote-snapshot-fix-v2/**"
        ]
    },
    {
        files: ["**/*.{js,mjs,cjs,jsx}"],
        plugins: {js, "unused-imports": unusedImports},
        extends: ["js/recommended"],
        languageOptions: {globals: {...globals.browser, ...globals.node}},
        rules: {
            "no-unused-vars": ["error", {argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true}],
            "unused-imports/no-unused-imports": "error",
            "no-redeclare": ["error", {builtinGlobals: false}]
        }
    },
    {
        files: ["enquote-sync-worker/src/**/*.js"],
        languageOptions: {globals: {WebSocketPair: "readonly", WebSocketRequestResponsePair: "readonly"}}
    },
    {
        files: ["src/**/*.{js,jsx}"],
        extends: [
            pluginReact.configs.flat.recommended,
            pluginReact.configs.flat["jsx-runtime"]
        ],
        settings: {react: {version: "detect"}},
        plugins: {"react-hooks": pluginReactHooks},
        rules: {
            "react/prop-types": "off",
            "react/display-name": "off",
            "react/no-unknown-property": ["error", {ignore: ["cmdk-input-wrapper"]}],
        },
    },
]);
