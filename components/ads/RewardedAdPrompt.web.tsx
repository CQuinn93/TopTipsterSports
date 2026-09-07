/** Web stub — auto-unlock when “visible”. */
import { useEffect } from 'react';

type Props = {
  placement: 'lmsStanding' | 't20Goalscorers';
  unlockKey: string;
  title?: string;
  body?: string;
  onUnlocked: () => void;
  visible: boolean;
  onCancel: () => void;
};

export function RewardedAdPrompt({ visible, onUnlocked }: Props) {
  useEffect(() => {
    if (visible) onUnlocked();
  }, [visible, onUnlocked]);
  return null;
}
