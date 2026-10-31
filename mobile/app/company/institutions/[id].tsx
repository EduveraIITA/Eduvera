import { useLocalSearchParams } from 'expo-router';
import { CompanyScreen } from '../../../src/features/CompanyScreen';
export default function Institution() { const {id} = useLocalSearchParams<{id:string}>(); return <CompanyScreen institutionId={id} />; }
