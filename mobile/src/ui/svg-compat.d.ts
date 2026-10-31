import 'react-native-svg';

// Phosphor's supported per-icon source entry points pass an optional className
// through IconBase. Native SVG ignores the absent web styling property; declare
// that optional compatibility field without pulling the entire icon barrel in.
declare module 'react-native-svg' {
  interface SvgProps { className?: string }
}
