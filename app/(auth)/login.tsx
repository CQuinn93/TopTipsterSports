import { useState, useMemo, useCallback, useLayoutEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandLogo } from '@/components/BrandLogo';
import {
  fetchMyEntitlements,
  isGamemasterAccount,
} from '@/lib/subscriptionEntitlements';

function isRunningAsInstalledWebApp(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)');
  if (mq?.matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}
function ContourDecor({ color, compact }: { color: string; compact: boolean }) {
  const rings = compact ? [140, 210, 280] : [200, 300, 400, 520];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: 'absolute',
          right: compact ? -100 : -160,
          top: compact ? -30 : -60,
          width: compact ? 340 : 580,
          height: compact ? 340 : 580,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {rings.map((size) => (
          <View
            key={size}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: color,
              opacity: 0.55,
            }}
          />
        ))}
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isCompact = width < 420 || height < 680;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [failedSignInAttempts, setFailedSignInAttempts] = useState(0);
  const [showResetHelper, setShowResetHelper] = useState(false);
  const showHomeScreenTip = Platform.OS === 'web' && !isRunningAsInstalledWebApp();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        bg: {
          flex: 1,
          backgroundColor: '#0a0a0a',
        },
        bgGradient: {
          ...StyleSheet.absoluteFillObject,
        },
        container: {
          flex: 1,
          padding: theme.spacing.lg,
          paddingTop: Math.max(theme.spacing.lg, insets.top + theme.spacing.sm),
          paddingBottom: Math.max(theme.spacing.lg, insets.bottom + theme.spacing.sm),
          zIndex: 1,
        },
        content: {
          flex: 1,
          maxWidth: 400,
          width: '100%',
          alignSelf: 'center',
          justifyContent: 'center',
        },
        wordmarkBlock: {
          alignItems: 'center',
          marginBottom: theme.spacing.xl,
        },
        brandLogo: {
          marginBottom: theme.spacing.xs,
        },
        wordmarkName: {
          fontFamily: theme.fontFamily.regular,
          fontSize: Platform.OS === 'web' ? 14 : 15,
          fontWeight: '700',
          color: theme.colors.accent,
          textAlign: 'center',
          marginTop: 8,
          letterSpacing: Platform.OS === 'web' ? 1 : 1.2,
        },
        wordmarkSub: {
          fontFamily: theme.fontFamily.regular,
          fontSize: Platform.OS === 'web' ? 14 : 15,
          fontWeight: '700',
          color: theme.colors.accent,
          textAlign: 'center',
          marginTop: 4,
          letterSpacing: Platform.OS === 'web' ? 6 : 7,
        },
        input: {
          fontFamily: theme.fontFamily.input,
          fontSize: 16,
          color: '#fafafa',
          backgroundColor: 'rgba(20, 20, 20, 0.92)',
          borderWidth: 1,
          borderColor: '#2a2a2a',
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          marginBottom: theme.spacing.md,
        },
        passwordField: {
          position: 'relative' as const,
          marginBottom: theme.spacing.md,
        },
        passwordInput: {
          marginBottom: 0,
          paddingRight: 48,
        },
        passwordToggle: {
          position: 'absolute' as const,
          right: 4,
          top: 0,
          bottom: 0,
          width: 44,
          justifyContent: 'center',
          alignItems: 'center',
        },
        signInError: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 13,
          color: '#f87171',
          marginTop: -theme.spacing.sm,
          marginBottom: theme.spacing.md,
          textAlign: 'left',
        },
        resetHelperCard: {
          backgroundColor: 'rgba(20, 20, 20, 0.92)',
          borderWidth: 1,
          borderColor: '#2a2a2a',
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          marginBottom: theme.spacing.md,
          gap: theme.spacing.sm,
        },
        resetHelperText: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 14,
          color: '#e5e5e5',
          lineHeight: 20,
          textAlign: 'center',
        },
        resetHelperActions: {
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: theme.spacing.md,
          marginTop: theme.spacing.xs,
        },
        resetHelperPrimary: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 14,
          fontWeight: '700',
          color: theme.colors.accent,
          textDecorationLine: 'underline',
        },
        resetHelperSecondary: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 14,
          color: '#a3a3a3',
        },
        button: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.md,
          alignItems: 'center',
          marginTop: theme.spacing.sm,
          marginBottom: theme.spacing.md,
        },
        buttonDisabled: {
          opacity: 0.7,
        },
        buttonText: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 18,
          color: theme.colors.white,
          fontWeight: '600',
        },
        switchText: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 14,
          color: theme.colors.accent,
          textAlign: 'center',
        },
        switchTextWrap: {
          marginTop: theme.spacing.lg,
        },
        forgotPasswordText: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 13,
          color: '#a3a3a3',
          textAlign: 'center',
          textDecorationLine: 'underline',
          marginTop: theme.spacing.sm,
        },
        policyRow: {
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: theme.spacing.md,
          marginTop: theme.spacing.xl,
        },
        policyLink: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 13,
          color: '#737373',
          textDecorationLine: 'underline',
        },
        hubLoginLink: {
          fontFamily: theme.fontFamily.regular,
          fontSize: 13,
          color: '#a3a3a3',
          textDecorationLine: 'underline',
        },
        homeTip: {
          marginTop: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#2a2a2a',
          gap: theme.spacing.sm,
        },
        homeTipText: {
          fontFamily:
            Platform.OS === 'web'
              ? 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
              : theme.fontFamily.input,
          fontSize: 13,
          color: '#a3a3a3',
          textAlign: 'center',
          lineHeight: 18,
        },
        homeTipBtn: {
          alignSelf: 'center',
          paddingVertical: 8,
          paddingHorizontal: 14,
        },
        homeTipBtnText: {
          fontFamily:
            Platform.OS === 'web'
              ? 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
              : theme.fontFamily.input,
          fontSize: 14,
          fontWeight: '700',
          color: theme.colors.accent,
          textDecorationLine: 'underline',
        },
      }),
    [theme, insets.bottom, insets.top]
  );

  const loginBg = ['#0a0a0a', '#111111', '#0a0a0a'] as const;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      const id = requestAnimationFrame(() => {
        window.scrollTo(0, 0);
      });
      return () => cancelAnimationFrame(id);
    }, [])
  );

  const WEB_VIEWPORT =
    'width=device-width, initial-scale=1, minimum-scale=1, shrink-to-fit=no, viewport-fit=cover';

  /** On refresh / direct load, re-apply viewport + scroll top so mobile browsers don’t stay at a stale zoom. */
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.setAttribute('content', WEB_VIEWPORT);
    }
    window.scrollTo(0, 0);
  }, []);

  const resetWebZoomChrome = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const el = document.activeElement;
    if (el && 'blur' in el && typeof (el as HTMLElement).blur === 'function') {
      (el as HTMLElement).blur();
    }
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  };

  /** Web: `Alert.alert` is unreliable — use a dismissible `window.alert` instead. */
  const showMessage = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const isWrongPasswordError = (e: unknown): boolean => {
    const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    const lower = raw.toLowerCase();
    return (
      lower.includes('invalid login') ||
      lower.includes('invalid credentials') ||
      lower.includes('user not found') ||
      lower.includes('invalid email or password') ||
      lower.includes('email not confirmed')
    );
  };

  const authErrorMessage = (e: unknown, mode: 'signIn' | 'signUp'): string => {
    const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    const lower = raw.toLowerCase();
    if (mode === 'signIn') {
      if (isWrongPasswordError(e)) {
        return 'Incorrect email or password. Please try again.';
      }
    }
    if (mode === 'signUp') {
      if (lower.includes('already registered') || lower.includes('already been registered')) {
        return 'An account with this email already exists. Sign in instead.';
      }
      if (lower.includes('password')) {
        return raw || 'Please choose a stronger password (at least 6 characters).';
      }
    }
    return raw || 'Something went wrong. Please try again.';
  };

  const clearSignInFeedback = () => {
    setSignInError(null);
    setShowResetHelper(false);
  };

  const registerFailedSignIn = (message: string) => {
    setSignInError(message);
    setFailedSignInAttempts((prev) => {
      const next = prev + 1;
      if (next >= 3) setShowResetHelper(true);
      return next;
    });
  };

  const handleAuth = async () => {
    clearSignInFeedback();
    if (!email.trim() || !password) {
      if (!isSignUp) {
        setSignInError('Please enter your email and password.');
      } else {
        showMessage('Missing details', 'Please enter your email and password.');
      }
      return;
    }
    if (isSignUp && !username.trim()) {
      showMessage('Username required', 'Please choose a username for the leaderboard.');
      return;
    }
    const trimmedUsername = username.trim().toLowerCase().replace(/\s+/g, '');
    if (isSignUp && trimmedUsername.length < 2) {
      showMessage('Username too short', 'Username must be at least 2 characters.');
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (signUpData.user) {
          const profilePayload = {
            id: signUpData.user.id,
            username: trimmedUsername,
            updated_at: new Date().toISOString(),
          };
          const { error: profileError } = await supabase
            .from('profiles')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase client infers insert as never when Database generic is used
            .insert(profilePayload as any);
          if (profileError) {
            if (profileError.code === '23505') {
              showMessage(
                'Username taken',
                'That username is already in use. Please choose another.'
              );
            } else {
              showMessage('Sign up failed', authErrorMessage(profileError, 'signUp'));
            }
            setLoading(false);
            return;
          }
        }
        showMessage(
          'Account created',
          'Your account was created successfully. You can now sign in with your email and password.'
        );
        setIsSignUp(false);
        setUsername('');
        setFailedSignInAttempts(0);
        clearSignInFeedback();
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        const { data: banned } = await (supabase as any).rpc('is_profile_banned');
        if (banned) {
          await supabase.auth.signOut();
          setFailedSignInAttempts(0);
          setShowResetHelper(false);
          setSignInError('This account has been banned and cannot sign in.');
          return;
        }
        setFailedSignInAttempts(0);
        clearSignInFeedback();
        resetWebZoomChrome();
        const ent = await fetchMyEntitlements();
        router.replace(isGamemasterAccount(ent) ? '/gamemaster-hub' : '/competition-hub');
      }
    } catch (e: unknown) {
      if (isSignUp) {
        showMessage('Sign up failed', authErrorMessage(e, 'signUp'));
      } else if (isWrongPasswordError(e)) {
        registerFailedSignIn('Incorrect email or password. Please try again.');
      } else {
        registerFailedSignIn(authErrorMessage(e, 'signIn'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    router.push({
      pathname: '/(auth)/forgot-password',
      params: trimmedEmail ? { email: trimmedEmail } : undefined,
    });
  };

  const dismissResetHelper = () => {
    setShowResetHelper(false);
    setFailedSignInAttempts(0);
  };

  return (
    <View style={styles.bg}>
      <LinearGradient
        colors={[...loginBg]}
        locations={[0, 0.45, 1]}
        style={styles.bgGradient}
        pointerEvents="none"
      />
      <ContourDecor color="rgba(250, 250, 250, 0.16)" compact={isCompact} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <View style={styles.content}>
        <View>
          <View style={styles.wordmarkBlock}>
            <BrandLogo size={isCompact ? 72 : 88} style={styles.brandLogo} />
            <Text style={styles.wordmarkName} accessibilityRole="header">
              Top Tipster
            </Text>
            <Text style={styles.wordmarkSub}>SPORTS</Text>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#737373"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (signInError) clearSignInFeedback();
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />
          <View style={styles.passwordField}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="Password"
              placeholderTextColor="#737373"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (signInError) setSignInError(null);
              }}
              secureTextEntry={!passwordVisible}
              editable={!loading}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              autoComplete="password"
            />
            <TouchableOpacity
              style={styles.passwordToggle}
              onPress={() => setPasswordVisible((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                size={22}
                color={theme.colors.textMuted}
              />
            </TouchableOpacity>
          </View>

          {!isSignUp && signInError ? (
            <Text style={styles.signInError} accessibilityLiveRegion="polite">
              {signInError}
            </Text>
          ) : null}

          {!isSignUp && showResetHelper ? (
            <View style={styles.resetHelperCard}>
              <Text style={styles.resetHelperText}>
                Still having trouble? Would you like to reset your password?
              </Text>
              <View style={styles.resetHelperActions}>
                <TouchableOpacity
                  onPress={() => void handleForgotPassword()}
                  disabled={loading || resetLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Yes, reset password"
                >
                  <Text style={styles.resetHelperPrimary}>Yes, reset password</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={dismissResetHelper}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="No thanks"
                >
                  <Text style={styles.resetHelperSecondary}>No thanks</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {isSignUp && (
            <TextInput
              style={styles.input}
              placeholder="Username (for leaderboard)"
              placeholderTextColor="#737373"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          )}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleAuth}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={theme.colors.white} />
            ) : (
              <Text style={styles.buttonText}>{isSignUp ? 'Sign up' : 'Sign in'}</Text>
            )}
          </TouchableOpacity>

          {!isSignUp && (
            <TouchableOpacity onPress={handleForgotPassword} disabled={loading || resetLoading}>
              <Text style={styles.forgotPasswordText}>{resetLoading ? 'Sending reset email...' : 'Forgot password?'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.switchTextWrap}
            onPress={() => {
              setIsSignUp(!isSignUp);
              setFailedSignInAttempts(0);
              clearSignInFeedback();
            }}
            disabled={loading}
          >
            <Text style={styles.switchText}>
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </Text>
          </TouchableOpacity>

          {showHomeScreenTip ? (
            <View style={styles.homeTip}>
              <Text style={styles.homeTipText}>
                For the best experience, add Top Tipster to your Home Screen.
              </Text>
              <TouchableOpacity
                style={styles.homeTipBtn}
                onPress={() => router.push('/(auth)/add-to-home-screen')}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Show me how to add to Home Screen"
              >
                <Text style={styles.homeTipBtnText}>Show me how</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <View style={styles.policyRow}>
          <TouchableOpacity
            onPress={() => Linking.openURL('https://doc-hosting.flycricket.io/top-tipster-racing-fantasy-sports-privacy-policy/98fbb3c4-4795-4774-bba7-c2ebb872eb92/privacy')}
            disabled={loading}
          >
            <Text style={styles.policyLink}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Linking.openURL('https://doc-hosting.flycricket.io/top-tipster-racing-terms-of-use/bf206b6c-02a2-4394-aedc-dbf95f95d955/terms')}
            disabled={loading}
          >
            <Text style={styles.policyLink}>Terms of Use</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/hub-login')}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Competition Hub login"
          >
            <Text style={styles.hubLoginLink}>Hub login</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

