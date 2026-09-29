import js from '@eslint/js';

export default [
    {
        ignores: ['node_modules/**'],
    },
    js.configs.recommended,
    {
        files: ['**/*.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                console: 'readonly',
                process: 'readonly',
            },
        },
        rules: {
            'no-console': 'off',
            'no-regex-spaces': 'off',
            'no-useless-escape': 'off',
        },
    },
];
