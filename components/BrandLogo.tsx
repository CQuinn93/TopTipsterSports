import { Image, type ImageStyle, type StyleProp } from 'react-native';

/** Top Tipster mark for dark UI surfaces. */
export const DARK_LOGO = require('@/assets/logo/Dark_logo.png');

type Props = {
  size?: number;
  style?: StyleProp<ImageStyle>;
};

export function BrandLogo({ size = 56, style }: Props) {
  return (
    <Image
      source={DARK_LOGO}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityLabel="Top Tipster"
    />
  );
}
