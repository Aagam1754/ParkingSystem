import { Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme';
import LoginScreen from '../screens/LoginScreen';
import CurrentSlotScreen from '../screens/CurrentSlotScreen';
import AssistantScreen from '../screens/AssistantScreen';
import VehiclesScreen from '../screens/VehiclesScreen';
import HistoryScreen from '../screens/HistoryScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ label, focused }) {
  const map = {
    Slot: '◆',
    Assist: '✦',
    Vehicles: '▣',
    History: '☰',
    Profile: '○',
  };
  return (
    <Text style={{ color: focused ? colors.accent : colors.muted, fontSize: 14 }}>
      {map[label] || '•'}
    </Text>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.bg1 },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: colors.bg1,
          borderTopColor: colors.line,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen
        name="Slot"
        component={CurrentSlotScreen}
        options={{ title: 'Current slot', tabBarLabel: 'Slot' }}
      />
      <Tab.Screen
        name="Assist"
        component={AssistantScreen}
        options={{ title: 'Parking assistant', tabBarLabel: 'Assist' }}
      />
      <Tab.Screen
        name="Vehicles"
        component={VehiclesScreen}
        options={{ title: 'My vehicles', tabBarLabel: 'Vehicles' }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{ title: 'Session history', tabBarLabel: 'History' }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile', tabBarLabel: 'Profile' }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { user } = useAuth();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}
