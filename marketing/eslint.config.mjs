import ts from 'typescript-eslint';
export default ts.config(...ts.configs.recommended,{files:['src/**/*.tsx','src/**/*.ts'],rules:{'@typescript-eslint/no-explicit-any':'error'}});
