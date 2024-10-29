// components/RenameDialog.tsx
import React, { useState } from 'react';
import { Portal, Dialog, TextInput, Button } from 'react-native-paper';

interface RenameDialogProps {
  visible: boolean;
  currentName: string;
  onDismiss: () => void;
  onRename: (newName: string) => void;
}

export function RenameDialog({ 
  visible, 
  currentName, 
  onDismiss, 
  onRename 
}: RenameDialogProps) {
  const [newName, setNewName] = useState(currentName);

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>Rename Image</Dialog.Title>
        <Dialog.Content>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            mode="outlined"
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
          <Button onPress={() => onRename(newName)}>Rename</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}