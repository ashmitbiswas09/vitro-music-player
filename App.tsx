import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { DebugScreen } from './src/dev/DebugScreen';

export default function App() {
  return (
    <View style={styles.container}>
      <DebugScreen />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
