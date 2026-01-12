module.exports = {
	root: true,
	env: {
		browser: false,
		es6: true,
		node: true,
	},
	parser: '@typescript-eslint/parser',
	parserOptions: {
		project: ['./tsconfig.json'],
		sourceType: 'module',
		tsconfigRootDir: __dirname,
	},
	ignorePatterns: ['dist/**', 'node_modules/**', 'gulpfile.js'],
	plugins: ['@typescript-eslint', 'n8n-nodes-base'],
	extends: [
		'plugin:n8n-nodes-base/community',
		'plugin:n8n-nodes-base/nodes',
		'plugin:n8n-nodes-base/credentials',
	],
	overrides: [
		{
			files: ['package.json'],
			parser: 'jsonc-eslint-parser',
			extends: ['plugin:n8n-nodes-base/community'],
		},
	],
	rules: {
		'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
		'n8n-nodes-base/community-package-json-author-name-still-default': [
			'error',
			{ authorName: 'HumanStep' },
		],
		'n8n-nodes-base/community-package-json-author-email-still-default': [
			'error',
			{ authorEmail: 'contact@humanstep.ai' },
		],
		'n8n-nodes-base/community-package-json-repository-url-still-default': [
			'error',
			{
				repositoryUrl: 'git+https://github.com/HumanStep-ai/HumanStep-n8n.git',
			},
		],
	},
};
