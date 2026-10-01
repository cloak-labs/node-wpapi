// Oxfmt owns formatting; ESLint checks program behavior.
module.exports = {
	root: true,
	env: {
		es6: true,
		node: true,
	},
	extends: 'eslint:recommended',
	parserOptions: {
		ecmaVersion: 2018,
	},
	rules: {
		eqeqeq: ['error'],
		'no-console': ['warn'],
		'no-var': ['error'],
		'prefer-arrow-callback': ['error'],
		'prefer-const': ['error'],
		yoda: ['error', 'never'],
	},
};
