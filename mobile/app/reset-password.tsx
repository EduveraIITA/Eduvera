import { useLocalSearchParams } from 'expo-router';
import { LoginScreen } from '../src/auth/LoginScreen';
export default function PasswordReset() { const { token } = useLocalSearchParams<{ token?: string | string[] }>(); return <LoginScreen initialMode="reset" resetToken={typeof token === 'string' ? token : undefined} />; }
