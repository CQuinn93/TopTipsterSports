import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useTheme } from '@/contexts/ThemeContext';
import {
  racingAdminBroadcastPush,
  racingDeleteCompetition,
  racingApproveJoinRequest,
  racingBroadcastErrorMessage,
  racingGetCompetitionJoinCodes,
  racingGetJoinNotifyPref,
  racingListAssignableManagers,
  racingListCompetitionManagers,
  racingAdminListPendingForCompetition,
  racingRejectJoinRequest,
  racingSetCompetitionEntry,
  racingSetCompetitionManager,
  racingSetJoinNotifyPref,
  type RacingAssignableManager,
} from '@/lib/racingAdminApi';

type AdminSubTab = 'joins' | 'users' | 'notify';

type PendingJoin = {
  id: string;
  user_id: string;
  username: string | null;
  created_at: string;
  payment_method?: string | null;
  payment_note?: string | null;
};

type Props = {
  competitionId: string;
  canManage: boolean;
  isCompManager: boolean;
  entry: string | null;
  competitionName?: string | null;
  /** Seed from racing_get_admin_context so the code shows even if admin RPCs partially fail. */
  initialJoinCode?: string | null;
  onEntrySaved?: (entry: string | null) => void;
};

export function RacingAdminPanel({
  competitionId,
  canManage,
  isCompManager,
  entry,
  competitionName = null,
  initialJoinCode = null,
  onEntrySaved,
}: Props) {
  const theme = useTheme();
  const [adminSubTab, setAdminSubTab] = useState<AdminSubTab>('joins');
  const [joinCode, setJoinCode] = useState<string | null>(
    initialJoinCode?.trim() || null
  );
  const [entryDraft, setEntryDraft] = useState(entry ?? '');
  const [entrySaving, setEntrySaving] = useState(false);
  const [pendingJoins, setPendingJoins] = useState<PendingJoin[]>([]);
  const [joinBusyId, setJoinBusyId] = useState<string | null>(null);
  const [joinNotifyEnabled, setJoinNotifyEnabled] = useState(false);
  const [joinNotifyBusy, setJoinNotifyBusy] = useState(false);
  const [managerUserIds, setManagerUserIds] = useState<Set<string>>(new Set());
  const [assignable, setAssignable] = useState<RacingAssignableManager[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [managerBusyId, setManagerBusyId] = useState<string | null>(null);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingAdmin, setLoadingAdmin] = useState(true);

  useEffect(() => {
    setEntryDraft(entry ?? '');
  }, [entry]);

  useEffect(() => {
    const seeded = initialJoinCode?.trim() || null;
    if (seeded) setJoinCode(seeded);
  }, [initialJoinCode]);

  useEffect(() => {
    if (!canManage && isCompManager && adminSubTab !== 'joins') {
      setAdminSubTab('joins');
    }
  }, [canManage, isCompManager, adminSubTab]);

  const loadAdmin = useCallback(async () => {
    setLoadingAdmin(true);
    try {
      // Load join code on its own so other admin RPC failures don't blank it.
      try {
        const codes = await racingGetCompetitionJoinCodes(competitionId);
        if (codes.success && codes.join_code) {
          setJoinCode(codes.join_code);
        }
      } catch {
        /* keep seeded / previous join code */
      }

      const [pending, notifyPref, managers] = await Promise.all([
        racingAdminListPendingForCompetition(competitionId),
        racingGetJoinNotifyPref(competitionId),
        racingListCompetitionManagers(competitionId),
      ]);
      setPendingJoins(
        pending.map((r) => ({
          id: r.id,
          user_id: r.user_id,
          username: r.username ?? r.display_name ?? null,
          created_at: r.created_at,
          payment_method: r.payment_method,
          payment_note: r.payment_note,
        }))
      );
      setJoinNotifyEnabled(!!notifyPref.enabled);
      setManagerUserIds(new Set(managers.map((m) => m.user_id)));
      if (canManage) {
        const list = await racingListAssignableManagers(competitionId);
        setAssignable(list);
      } else {
        setAssignable([]);
      }
    } catch (e) {
      Alert.alert('Admin', e instanceof Error ? e.message : 'Failed to load admin data');
    } finally {
      setLoadingAdmin(false);
    }
  }, [competitionId, canManage]);

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  const selectedUser = useMemo(
    () => assignable.find((p) => p.user_id === selectedUserId) ?? null,
    [assignable, selectedUserId]
  );

  const copyAccessCode = async () => {
    if (!joinCode) {
      Alert.alert('No join code', 'This competition does not have a join code yet.');
      return;
    }
    try {
      await Clipboard.setStringAsync(joinCode);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`Join code ${joinCode} copied.`);
      } else {
        Alert.alert('Copied', `Join code ${joinCode} copied.`);
      }
    } catch {
      Alert.alert('Copy failed', 'Could not copy the join code.');
    }
  };

  const onSaveEntry = async () => {
    setEntrySaving(true);
    try {
      const res = await racingSetCompetitionEntry(competitionId, entryDraft);
      if (!res.success) {
        Alert.alert('Entry fee', res.error ?? 'Could not save');
        return;
      }
      onEntrySaved?.(res.entry ?? null);
      Alert.alert('Saved', 'Entry fee updated.');
    } catch (e) {
      Alert.alert('Entry fee', e instanceof Error ? e.message : 'Could not save');
    } finally {
      setEntrySaving(false);
    }
  };

  const onToggleJoinNotify = async (next: boolean) => {
    setJoinNotifyBusy(true);
    const prev = joinNotifyEnabled;
    setJoinNotifyEnabled(next);
    try {
      const res = await racingSetJoinNotifyPref(competitionId, next);
      if (!res.success) {
        setJoinNotifyEnabled(prev);
        Alert.alert('Notifications', res.error ?? 'Could not update preference');
      }
    } catch (e) {
      setJoinNotifyEnabled(prev);
      Alert.alert('Notifications', e instanceof Error ? e.message : 'Could not update');
    } finally {
      setJoinNotifyBusy(false);
    }
  };

  const handleJoin = async (requestId: string, approve: boolean) => {
    setJoinBusyId(requestId);
    try {
      const res = approve
        ? await racingApproveJoinRequest(requestId)
        : await racingRejectJoinRequest(requestId);
      if (!res.success) {
        Alert.alert('Error', res.error ?? 'Action failed');
        return;
      }
      await loadAdmin();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Action failed');
    } finally {
      setJoinBusyId(null);
    }
  };

  const onToggleManager = async (targetUserId: string, next: boolean) => {
    setManagerBusyId(targetUserId);
    try {
      const res = await racingSetCompetitionManager(competitionId, targetUserId, next);
      if (!res.success) {
        if (res.error === 'manager_limit') {
          Alert.alert('Managers', `You can assign up to ${res.max ?? 3} managers.`);
        } else if (res.error === 'already_creator') {
          Alert.alert('Managers', 'The competition creator is already an admin.');
        } else {
          Alert.alert('Managers', res.error ?? 'Could not update manager');
        }
        return;
      }
      await loadAdmin();
    } catch (e) {
      Alert.alert('Managers', e instanceof Error ? e.message : 'Could not update');
    } finally {
      setManagerBusyId(null);
    }
  };

  const onSendBroadcast = async () => {
    setBroadcastSending(true);
    try {
      const res = await racingAdminBroadcastPush(
        competitionId,
        broadcastTitle.trim(),
        broadcastBody.trim()
      );
      if (!res.success) {
        Alert.alert('Notify', racingBroadcastErrorMessage(res.error));
        return;
      }
      Alert.alert(
        'Sent',
        `Notification sent to ${res.users_notified ?? res.sent ?? 0} device(s).`
      );
      setBroadcastTitle('');
      setBroadcastBody('');
    } catch (e) {
      Alert.alert('Notify', e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBroadcastSending(false);
    }
  };

  const confirmDestructive = (
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void
  ) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`${title}\n\n${message}`)) onConfirm();
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);
  };

  const onDeleteCompetition = () => {
    const label = competitionName?.trim() || 'This competition';
    confirmDestructive(
      'Delete competition?',
      `“${label}” will be permanently deleted, including all players, picks, and access codes. This cannot be undone.`,
      'Delete',
      () => {
        void (async () => {
          setDeleting(true);
          try {
            const res = await racingDeleteCompetition(competitionId);
            if (!res.success) {
              Alert.alert('Could not delete', res.error ?? 'Unknown error');
              return;
            }
            router.replace('/(app)' as any);
          } catch (e) {
            Alert.alert(
              'Error',
              e instanceof Error ? e.message : 'Could not delete competition'
            );
          } finally {
            setDeleting(false);
          }
        })();
      }
    );
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        joinCodeCard: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
        },
        joinCodeLabel: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 11,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
        },
        joinCodeRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
        },
        joinCodeValue: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 28,
          letterSpacing: 2,
          color: theme.colors.text,
        },
        joinCodeHint: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
          marginTop: 2,
        },
        entryInput: {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.sm,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: Platform.OS === 'web' ? 10 : 11,
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.text,
          backgroundColor: theme.colors.background,
        },
        broadcastBodyInput: {
          minHeight: 88,
          paddingTop: 10,
        },
        entrySaveBtn: {
          alignSelf: 'flex-start',
          paddingVertical: 7,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.accent,
        },
        entrySaveBtnText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 13,
          color: theme.colors.accent,
        },
        shareInviteBtn: {
          marginTop: 4,
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        },
        shareInviteBtnText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.white,
        },
        adminSubTabs: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        },
        adminSubTab: {
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
        adminSubTabActive: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        adminSubTabText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textSecondary,
        },
        adminSubTabTextActive: {
          color: theme.colors.accent,
        },
        sectionIntro: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 13,
          color: theme.colors.textSecondary,
          lineHeight: 18,
        },
        muted: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        poolTitle: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 12,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: theme.colors.textMuted,
        },
        adminRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
        },
        adminRowBody: { flex: 1, minWidth: 0, gap: 4 },
        adminRowTitle: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.text,
        },
        adminRowMeta: {
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 12,
          color: theme.colors.textMuted,
          lineHeight: 16,
        },
        adminToggle: {
          minWidth: 64,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          alignItems: 'center',
        },
        adminToggleOn: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        adminToggleOff: {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.background,
        },
        adminToggleTextOn: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 12,
          color: theme.colors.accent,
        },
        adminToggleTextOff: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textMuted,
        },
        pendingCard: {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
          gap: 8,
        },
        pendingName: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 15,
          color: theme.colors.text,
        },
        adminActions: { flexDirection: 'row', gap: 8 },
        adminBtn: {
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        adminBtnApprove: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accentMuted,
        },
        adminBtnText: {
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 12,
          color: theme.colors.textSecondary,
        },
        adminBtnTextActive: {
          color: theme.colors.accent,
        },
        manageDropdownTrigger: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        },
        manageDropdownValue: {
          flex: 1,
          fontFamily: theme.fontFamily.baiMedium,
          fontSize: 14,
          color: theme.colors.text,
        },
        manageDropdownPlaceholder: {
          flex: 1,
          fontFamily: theme.fontFamily.baiLight,
          fontSize: 14,
          color: theme.colors.textMuted,
        },
        manageDropdownMenu: {
          maxHeight: 220,
          borderRadius: theme.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        },
        manageDropdownOption: {
          paddingVertical: 11,
          paddingHorizontal: theme.spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          gap: 2,
        },
        manageDropdownOptionActive: {
          backgroundColor: theme.colors.accentMuted,
        },
        playerNameRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        },
        primaryBtn: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.md,
          paddingVertical: 12,
          alignItems: 'center',
        },
        primaryBtnDisabled: { opacity: 0.45 },
        primaryBtnText: {
          fontFamily: theme.fontFamily.baiBold,
          fontSize: 14,
          color: theme.colors.white,
        },
        dangerZone: {
          marginTop: theme.spacing.md,
          paddingTop: theme.spacing.lg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          gap: theme.spacing.sm,
        },
        dangerBtn: {
          borderRadius: theme.radius.md,
          paddingVertical: 14,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: theme.colors.error,
          backgroundColor: 'transparent',
        },
        dangerBtnDisabled: {
          opacity: 0.45,
        },
        dangerBtnText: {
          fontFamily: theme.fontFamily.baiSemiBold,
          fontSize: 14,
          color: theme.colors.error,
        },
      }),
    [theme]
  );

  if (loadingAdmin && !joinCode) {
    return <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 12 }} />;
  }

  const creatorSubTabs: { key: AdminSubTab; label: string }[] = [
    { key: 'joins', label: 'Join requests' },
    { key: 'users', label: 'Manage user' },
    { key: 'notify', label: 'Notify' },
  ];
  const managerSubTabs: { key: AdminSubTab; label: string }[] = [
    { key: 'joins', label: 'Join requests' },
  ];

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={styles.joinCodeCard}>
        <Text style={styles.joinCodeLabel}>Join code</Text>
        <Pressable
          style={styles.joinCodeRow}
          onPress={() => void copyAccessCode()}
          accessibilityRole="button"
          accessibilityLabel={
            joinCode ? `Copy join code ${joinCode}` : 'No join code available'
          }
        >
          <View>
            <Text style={styles.joinCodeValue}>{joinCode ?? '————'}</Text>
            <Text style={styles.joinCodeHint}>
              {joinCode ? 'Tap to copy · share with players' : 'No join code yet'}
            </Text>
          </View>
          {joinCode ? (
            <Ionicons name="copy-outline" size={22} color={theme.colors.accent} />
          ) : null}
        </Pressable>

        {canManage ? (
          <>
            <Text style={styles.joinCodeLabel}>Entry fee</Text>
            <TextInput
              style={styles.entryInput}
              value={entryDraft}
              onChangeText={setEntryDraft}
              placeholder="€10 cash to organiser"
              placeholderTextColor={theme.colors.textMuted}
              autoCorrect={false}
              editable={!entrySaving}
            />
            <Text style={styles.joinCodeHint}>
              Display only — money is not taken in the app.
            </Text>
            <Pressable
              style={styles.entrySaveBtn}
              onPress={() => void onSaveEntry()}
              disabled={entrySaving}
            >
              {entrySaving ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : (
                <Text style={styles.entrySaveBtnText}>Save entry</Text>
              )}
            </Pressable>
          </>
        ) : null}

        <Pressable
          style={styles.shareInviteBtn}
          onPress={() =>
            router.push({
              pathname: '/(app)/share/[competitionId]',
              params: { competitionId },
            } as any)
          }
        >
          <Ionicons name="share-outline" size={18} color={theme.colors.white} />
          <Text style={styles.shareInviteBtnText}>Share</Text>
        </Pressable>
      </View>

      {loadingAdmin ? (
        <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 8 }} />
      ) : (
        <>
      {canManage ? (
        <View style={styles.adminSubTabs}>
          {creatorSubTabs.map((t) => {
            const active = adminSubTab === t.key;
            return (
              <Pressable
                key={t.key}
                style={[styles.adminSubTab, active && styles.adminSubTabActive]}
                onPress={() => setAdminSubTab(t.key)}
              >
                <Text
                  style={[styles.adminSubTabText, active && styles.adminSubTabTextActive]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : isCompManager ? (
        <View style={styles.adminSubTabs}>
          {managerSubTabs.map((t) => {
            const active = adminSubTab === t.key;
            return (
              <Pressable
                key={t.key}
                style={[styles.adminSubTab, active && styles.adminSubTabActive]}
                onPress={() => setAdminSubTab(t.key)}
              >
                <Text
                  style={[styles.adminSubTabText, active && styles.adminSubTabTextActive]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {adminSubTab === 'joins' ? (
        <>
          <Text style={styles.sectionIntro}>
            Confirm or reject players who have requested to join this competition with a code.
          </Text>
          <View style={styles.adminRow}>
            <View style={styles.adminRowBody}>
              <Text style={styles.adminRowTitle}>Notify me on join requests</Text>
              <Text style={styles.adminRowMeta}>
                Creators and managers default on; Owners default off.
              </Text>
            </View>
            <Pressable
              style={[
                styles.adminToggle,
                joinNotifyEnabled ? styles.adminToggleOn : styles.adminToggleOff,
              ]}
              disabled={joinNotifyBusy}
              onPress={() => void onToggleJoinNotify(!joinNotifyEnabled)}
            >
              <Text
                style={
                  joinNotifyEnabled ? styles.adminToggleTextOn : styles.adminToggleTextOff
                }
              >
                {joinNotifyEnabled ? 'On' : 'Off'}
              </Text>
            </Pressable>
          </View>
          {canManage ? (
            <Text style={styles.muted}>
              Managers · {managerUserIds.size}/3 · assign in Manage user
            </Text>
          ) : null}
          <Text style={styles.poolTitle}>
            Join requests · {pendingJoins.length} waiting
          </Text>
          {pendingJoins.length === 0 ? (
            <Text style={styles.muted}>No users waiting for verification.</Text>
          ) : (
            pendingJoins.map((p) => (
              <View key={p.id} style={styles.pendingCard}>
                <Text style={styles.pendingName}>
                  {p.username?.trim() || p.user_id.slice(0, 8)}
                </Text>
                <Text style={styles.muted}>
                  Requested {new Date(p.created_at).toLocaleString()}
                </Text>
                {p.payment_method ? (
                  <Text style={styles.muted}>
                    {p.payment_method === 'cash'
                      ? 'Payment: cash at collection'
                      : p.payment_method === 'online'
                        ? 'Payment: online'
                        : `Payment: ${p.payment_method}`}
                  </Text>
                ) : null}
                <View style={styles.adminActions}>
                  <Pressable
                    style={[styles.adminBtn, styles.adminBtnApprove]}
                    disabled={joinBusyId === p.id}
                    onPress={() => void handleJoin(p.id, true)}
                  >
                    <Text style={styles.adminBtnTextActive}>Approve</Text>
                  </Pressable>
                  <Pressable
                    style={styles.adminBtn}
                    disabled={joinBusyId === p.id}
                    onPress={() => void handleJoin(p.id, false)}
                  >
                    <Text style={styles.adminBtnText}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </>
      ) : null}

      {adminSubTab === 'users' && canManage ? (
        <>
          <Text style={styles.sectionIntro}>
            Select a player to assign them as a manager (up to 3). Managers can accept join
            requests and receive join alerts.
          </Text>
          <Text style={styles.poolTitle}>Player · managers {managerUserIds.size}/3</Text>
          {assignable.length === 0 ? (
            <Text style={styles.muted}>
              No players in this competition yet. Accept join requests first.
            </Text>
          ) : (
            <View>
              <Pressable
                style={styles.manageDropdownTrigger}
                onPress={() => setDropdownOpen((o) => !o)}
              >
                <View style={styles.playerNameRow}>
                  <Text
                    style={
                      selectedUser
                        ? styles.manageDropdownValue
                        : styles.manageDropdownPlaceholder
                    }
                    numberOfLines={1}
                  >
                    {selectedUser
                      ? selectedUser.username?.trim() || selectedUser.user_id.slice(0, 8)
                      : 'Select a player'}
                  </Text>
                  {selectedUser?.is_manager ? (
                    <Ionicons name="star" size={14} color={theme.colors.accent} />
                  ) : null}
                </View>
                <Ionicons
                  name={dropdownOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={theme.colors.textMuted}
                />
              </Pressable>
              {dropdownOpen ? (
                <View style={styles.manageDropdownMenu}>
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {assignable.map((p) => {
                      const active = selectedUserId === p.user_id;
                      const label = p.username?.trim() || p.user_id.slice(0, 8);
                      return (
                        <Pressable
                          key={p.user_id}
                          style={[
                            styles.manageDropdownOption,
                            active && styles.manageDropdownOptionActive,
                          ]}
                          onPress={() => {
                            setSelectedUserId(p.user_id);
                            setDropdownOpen(false);
                          }}
                        >
                          <View style={styles.playerNameRow}>
                            <Text style={styles.manageDropdownValue} numberOfLines={1}>
                              {label}
                            </Text>
                            {p.is_manager ? (
                              <Ionicons name="star" size={14} color={theme.colors.accent} />
                            ) : null}
                          </View>
                          <Text style={styles.adminRowMeta}>
                            {p.is_creator
                              ? 'Creator'
                              : p.is_manager
                                ? 'Manager'
                                : 'Player'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          )}

          {selectedUser ? (
            <View style={styles.adminRow}>
              <View style={styles.adminRowBody}>
                <View style={styles.playerNameRow}>
                  <Text style={styles.adminRowTitle}>
                    {selectedUser.username?.trim() || selectedUser.user_id.slice(0, 8)}
                  </Text>
                  {selectedUser.is_manager ? (
                    <Ionicons name="star" size={14} color={theme.colors.accent} />
                  ) : null}
                </View>
                <Text style={styles.adminRowMeta}>
                  {selectedUser.is_creator
                    ? 'Competition creator — already an admin'
                    : selectedUser.is_manager
                      ? 'Can accept join requests and get join alerts'
                      : 'Player — assign to handle join requests'}
                </Text>
              </View>
              {selectedUser.is_creator ? (
                <View style={[styles.adminToggle, styles.adminToggleOn]}>
                  <Text style={styles.adminToggleTextOn}>Creator</Text>
                </View>
              ) : (
                <Pressable
                  style={[
                    styles.adminToggle,
                    selectedUser.is_manager ? styles.adminToggleOn : styles.adminToggleOff,
                  ]}
                  disabled={managerBusyId === selectedUser.user_id}
                  onPress={() =>
                    void onToggleManager(selectedUser.user_id, !selectedUser.is_manager)
                  }
                >
                  {managerBusyId === selectedUser.user_id ? (
                    <ActivityIndicator size="small" color={theme.colors.accent} />
                  ) : (
                    <Text
                      style={
                        selectedUser.is_manager
                          ? styles.adminToggleTextOn
                          : styles.adminToggleTextOff
                      }
                    >
                      {selectedUser.is_manager ? 'Manager' : 'Assign'}
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          ) : null}
        </>
      ) : null}

      {adminSubTab === 'notify' && canManage ? (
        <>
          <Text style={styles.sectionIntro}>
            Send a custom push to players in this competition — for example a deadline reminder
            or short update.
          </Text>
          <Text style={styles.muted}>
            Only reaches players with alerts enabled. Max one send every few minutes.
          </Text>
          <Text style={styles.poolTitle}>Title</Text>
          <TextInput
            style={styles.entryInput}
            value={broadcastTitle}
            onChangeText={setBroadcastTitle}
            placeholder="e.g. Deadline reminder"
            placeholderTextColor={theme.colors.textMuted}
            maxLength={80}
            editable={!broadcastSending}
          />
          <Text style={styles.poolTitle}>Message</Text>
          <TextInput
            style={[styles.entryInput, styles.broadcastBodyInput]}
            value={broadcastBody}
            onChangeText={setBroadcastBody}
            placeholder="Write a short update for the group…"
            placeholderTextColor={theme.colors.textMuted}
            maxLength={280}
            multiline
            textAlignVertical="top"
            editable={!broadcastSending}
          />
          <Text style={styles.joinCodeHint}>{broadcastBody.trim().length}/280</Text>
          <Pressable
            style={[
              styles.primaryBtn,
              (broadcastSending || !broadcastTitle.trim() || !broadcastBody.trim()) &&
                styles.primaryBtnDisabled,
            ]}
            disabled={
              broadcastSending || !broadcastTitle.trim() || !broadcastBody.trim()
            }
            onPress={() => void onSendBroadcast()}
          >
            {broadcastSending ? (
              <ActivityIndicator color={theme.colors.white} />
            ) : (
              <Text style={styles.primaryBtnText}>Send to competition</Text>
            )}
          </Pressable>
        </>
      ) : null}
        </>
      )}

      {canManage ? (
        <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
          <Text style={styles.poolTitle}>Selections</Text>
          <Text style={styles.muted}>Open the admin editor for this competition.</Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() =>
              router.push({
                pathname: '/(auth)/admin',
                params: { returnTo: `/(app)/competition/${competitionId}` },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Edit selections"
          >
            <Text style={styles.primaryBtnText}>Edit selections</Text>
          </Pressable>
        </View>
      ) : null}

      {canManage ? (
        <View style={styles.dangerZone}>
          <Text style={styles.poolTitle}>Danger zone</Text>
          <Text style={styles.muted}>
            Permanently delete this competition and all related picks, players, and codes.
          </Text>
          <Pressable
            style={[styles.dangerBtn, deleting && styles.dangerBtnDisabled]}
            disabled={deleting}
            onPress={onDeleteCompetition}
            accessibilityRole="button"
            accessibilityLabel="Delete competition"
          >
            {deleting ? (
              <ActivityIndicator color={theme.colors.error} />
            ) : (
              <Text style={styles.dangerBtnText}>Delete competition</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
