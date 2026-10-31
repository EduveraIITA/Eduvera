import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../src/ui/components.tsx', import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const exports: Record<string, any> = {};
const dependencies: Record<string, any> = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': { View: 'native-view', Text: 'native-text', TextInput: 'native-input', Pressable: 'native-button', StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } },
  'react-native-screens/experimental': {}, 'expo-router/react-navigation': {}, 'react-native-safe-area-context': {},
  './native-tab-insets-context': {}, './theme': { useTheme: () => ({ colors: { row: '#eee', surface: '#fff', surfaceSoft: '#eee', border: '#777', ink: '#111', muted: '#555' } }) },
  './Icon': { Icon: () => null }, './ExecutionBanner': {}, './theme-tokens': { themeRadii: { radiusControl: 16 } }, './AssistantMark': { BrandLoadingIcon: () => null },
  './native-screen-insets': {}, '../lib/campus-workspace-layout': {}, './BackNavigation': {},
};
runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
function parts(value: any): any[] { return !value || typeof value !== 'object' ? [] : [value, ...React.Children.toArray(value.props?.children).flatMap(parts)]; }

test('search keyboard submission cannot bypass a busy, disabled or too-short search action', () => {
  for (const flags of [{ disabled: true }, { busy: true }, { submitDisabled: true }, {}]) {
    let submitted = 0;
    const nodes = parts(exports.SearchField({ label: 'Person', placeholder: 'Find person', value: 'A', onChangeText() {}, onSubmit: () => submitted++, ...flags }));
    const input = nodes.find(node => node.type === 'native-input'), button = nodes.find(node => node.type === 'native-button' && node.props.accessibilityLabel === 'Submit person');
    const blocked = Object.values(flags).some(Boolean);
    assert.equal(button.props.disabled, blocked);
    input.props.onSubmitEditing(); button.props.onPress();
    assert.equal(submitted, blocked ? 0 : 2);
  }
});

test('localized search actions clear the draft and submitted query once without submitting again', () => {
  const changes: string[] = []; let cleared = 0, submitted = 0;
  const nodes = parts(exports.SearchField({ label: 'नाम', placeholder: 'नाम', value: 'AB', onChangeText: (value: string) => changes.push(value), onClear: () => cleared++, onSubmit: () => submitted++, clearLabel: 'खोज साफ़ करें', submitLabel: 'व्यक्ति खोजें' }));
  const clear = nodes.find(node => node.type === 'native-button' && node.props.accessibilityLabel === 'खोज साफ़ करें');
  assert.ok(nodes.some(node => node.type === 'native-button' && node.props.accessibilityLabel === 'व्यक्ति खोजें'));
  clear.props.onPress(); assert.deepEqual(changes, ['']); assert.equal(cleared, 1); assert.equal(submitted, 0);
});
