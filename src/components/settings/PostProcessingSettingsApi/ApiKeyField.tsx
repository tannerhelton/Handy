import React, { useState } from "react";
import { Input } from "../../ui/Input";

interface ApiKeyFieldProps {
  onSave: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
  className?: string;
}

// The saved key is never sent to the webview, so this field always starts
// empty. A non-empty value is saved on blur and then cleared from the input.
export const ApiKeyField: React.FC<ApiKeyFieldProps> = React.memo(
  ({ onSave, disabled, placeholder, className = "" }) => {
    const [localValue, setLocalValue] = useState("");

    return (
      <Input
        type="password"
        autoComplete="off"
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={() => {
          const trimmed = localValue.trim();
          setLocalValue("");
          if (trimmed) {
            onSave(trimmed);
          }
        }}
        placeholder={placeholder}
        variant="compact"
        disabled={disabled}
        className={`flex-1 min-w-[320px] ${className}`}
      />
    );
  },
);

ApiKeyField.displayName = "ApiKeyField";
