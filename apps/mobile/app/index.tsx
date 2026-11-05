import { colors } from '@erp/shared';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../src/auth';

/** Sends each person to the screens for their role. */
export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (user.studentId || user.guardianId) return <Redirect href="/family" />;
  return <Redirect href="/staff" />;
}
