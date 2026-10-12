import {splitInlineEmojis} from "@/features/collab/inlineEmojis";
import CustomEmojiImage from "./CustomEmojiImage";

export default function InlineMessageBody({body}) {
  return splitInlineEmojis(body).map((part, index) => part.id
    ? <CustomEmojiImage key={index} id={part.id} name={part.name} size={24} />
    : part.text);
}
