import type { ComponentPropsWithoutRef } from "react";
import {
  formatMessage,
  localeTextAttributes,
  type MessageValues,
} from "../lib/localeMessages";
import type { MessageLocaleResourceV1 } from "../locales/en-US.messages";

interface LocalizedMessageProps
  extends Omit<ComponentPropsWithoutRef<"span">, "children" | "dir" | "lang"> {
  readonly messageKey: string;
  readonly values?: MessageValues;
  readonly locale?: MessageLocaleResourceV1;
}

/**
 * A small adoption surface for new copy. `textAlign: start` and
 * `unicodeBidi: plaintext` keep embedded chip counts/names readable when a
 * future RTL locale is selected.
 */
export function LocalizedMessage({
  messageKey,
  values,
  locale,
  style,
  ...props
}: LocalizedMessageProps) {
  const attributes = localeTextAttributes(locale);
  return (
    <span
      {...props}
      {...attributes}
      style={{ textAlign: "start", unicodeBidi: "plaintext", ...style }}
    >
      {formatMessage(messageKey, values, locale)}
    </span>
  );
}
