import { colors } from '@erp/shared';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/auth';
import { tabIcon } from '../../src/ui';

export default function StaffLayout() {
  const { user, loading } = useAuth();
  if (!loading && !user) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Classes', tabBarIcon: tabIcon('grid') }}
      />
      <Tabs.Screen
        name="leaves"
        options={{ title: 'Leave', tabBarIcon: tabIcon('calendar') }}
      />
      <Tabs.Screen
        name="notices"
        options={{ title: 'Notices', tabBarIcon: tabIcon('megaphone') }}
      />
    </Tabs>
  );
}
