// app/(tabs)/settings.tsx

import React, { useContext } from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { Surface, Text, List, Switch, RadioButton, useTheme } from 'react-native-paper';
import { ThemeContext } from '../../contexts/ThemeContext';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [isDeviceConnected, setIsDeviceConnected] = React.useState(false);
  const [autoProcess, setAutoProcess] = React.useState(false);

  const { themeName, setThemeName } = useContext(ThemeContext);

  return (
    <ScrollView style={styles.container}>
      <Surface style={styles.surface}>
        <Text style={styles.title}>Device Settings</Text>

        <List.Section>
          <List.Item
            title="Device Connection"
            description={isDeviceConnected ? 'Connected' : 'Disconnected'}
            left={(props) => <List.Icon {...props} icon="bluetooth" />}
            right={() => <Switch value={isDeviceConnected} onValueChange={setIsDeviceConnected} />}
          />

          <List.Item
            title="Auto Process Images"
            description="Automatically process images when selected"
            left={(props) => <List.Icon {...props} icon="auto-fix" />}
            right={() => <Switch value={autoProcess} onValueChange={setAutoProcess} />}
          />
        </List.Section>

        <List.Section>
          <List.Subheader>App Theme</List.Subheader>
          <RadioButton.Group onValueChange={(value) => setThemeName(value)} value={themeName}>
            <RadioButton.Item label="Light Theme (White/Blue)" value="light" />
            <RadioButton.Item label="Grey Theme (Grey/Yellow)" value="grey" />
            <RadioButton.Item label="Dark Theme (Black/Green)" value="dark" />
          </RadioButton.Group>
        </List.Section>

        <List.Section>
          <List.Subheader>Device Information</List.Subheader>
          <List.Item
            title="Device Name"
            description="FrameInk Display"
            left={(props) => <List.Icon {...props} icon="tablet" />}
          />
          <List.Item
            title="Battery Level"
            description="85%"
            left={(props) => <List.Icon {...props} icon="battery" />}
          />
          <List.Item
            title="Firmware Version"
            description="1.0.0"
            left={(props) => <List.Icon {...props} icon="information" />}
          />
        </List.Section>
      </Surface>
    </ScrollView>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    surface: {
      margin: 16,
      padding: 16,
      elevation: 4,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 20,
      color: colors.text,
    },
  });