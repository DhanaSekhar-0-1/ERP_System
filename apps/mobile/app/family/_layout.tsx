import { colors } from '@erp/shared';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/auth';
import { tabIcon } from '../../src/ui';

export default function FamilyLayout() {
  const { user, loading } = useAuth();
  if (!loading && !user) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Attendance', tabBarIcon: tabIcon('calendar') }}
      />
      <Tabs.Screen
        name="leave"
        options={{ title: 'Leave', tabBarIcon: tabIcon('document-text') }}
      />
      <Tabs.Screen
        name="notices"
        options={{ title: 'Notices', tabBarIcon: tabIcon('megaphone') }}
      />
    </Tabs>
  );
}
