import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  loadActiveRun,
  advanceToNode,
  abandonRun,
} from '../services/rogue/rogueRunService';
import {
  getSelectableNextNodes,
  isRunActive,
  ROGUE_RUN_STATUS,
} from '../domain/rogue/rogueRun';
import { ROGUE_NODE_TYPES } from '../domain/rogue/mapGenerator';

export default function RogueMapScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState(null);
  const [advancing, setAdvancing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const fetchRun = useCallback(async () => {
    try {
      setLoading(true);
      const active = await loadActiveRun();
      if (!active) {
        Alert.alert('No Expedition', 'No active expedition found.', [
          { text: 'OK', onPress: () => navigation.navigate('RogueHome') },
        ]);
        return;
      }
      setRun(active);
    } catch (err) {
      console.warn('[RogueMapScreen] Error loading run:', err);
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  const handleSelectNode = async (nodeId) => {
    if (!run || advancing) return;

    const selectables = getSelectableNextNodes(run);
    if (!selectables.includes(nodeId)) {
      setStatusMessage(`Node ${nodeId} cannot be selected. Only connected nodes may be visited.`);
      return;
    }

    try {
      setAdvancing(true);
      setStatusMessage('');
      const updated = await advanceToNode(nodeId);
      setRun(updated);

      if (updated.status === ROGUE_RUN_STATUS.VICTORY) {
        setStatusMessage('🏆 Reached Boss! Expedition Complete!');
      } else {
        setStatusMessage(`Advanced to ${updated.route.nodes[nodeId]?.type || 'node'}`);
      }
    } catch (err) {
      Alert.alert('Move Error', err.message || 'Cannot advance to node');
    } finally {
      setAdvancing(false);
    }
  };

  const handleAbandon = () => {
    Alert.alert(
      t('rogue.abandonExpedition', 'Abandon Expedition'),
      t('rogue.confirmAbandon', 'Are you sure you want to abandon this expedition?'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Abandon',
          style: 'destructive',
          onPress: async () => {
            try {
              setAdvancing(true);
              const updated = await abandonRun();
              setRun(updated);
              navigation.navigate('RogueHome');
            } catch (err) {
              Alert.alert('Error', err.message || 'Failed to abandon run');
            } finally {
              setAdvancing(false);
            }
          },
        },
      ]
    );
  };

  if (loading || !run) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  const selectables = getSelectableNextNodes(run);
  const visitedSet = new Set(run.route.visitedNodeIds || []);
  const currentNodeId = run.currentNodeId;

  // Group nodes by row
  const rowCount = run.route.rowCount || 5;
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const nodesInRow = Object.values(run.route.nodes).filter((n) => n.row === r);
    nodesInRow.sort((a, b) => a.col - b.col);
    rows.push({ row: r, nodes: nodesInRow });
  }

  // Reverse rows so Boss is displayed at the top and Start at the bottom
  const displayRows = [...rows].reverse();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('RogueHome')}
          accessibilityRole="button"
          accessibilityLabel="Back to Expedition Menu"
        >
          <Ionicons name="arrow-back" size={22} color="#E2E8F0" />
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.headerTitle}>{t('rogue.map', 'Expedition Map')}</Text>
          <Text style={styles.headerSubtitle}>Seed: #{run.seed}</Text>
        </View>
        <TouchableOpacity
          style={styles.abandonBtnSmall}
          onPress={handleAbandon}
          accessibilityRole="button"
          accessibilityLabel="Abandon Expedition"
        >
          <Ionicons name="flag-outline" size={20} color="#EF4444" />
        </TouchableOpacity>
      </View>

      {/* Player Status Ribbon */}
      <View style={styles.ribbon}>
        <View style={styles.ribbonItem}>
          <Text style={styles.ribbonLabel}>PLAYER HP</Text>
          <Text style={styles.ribbonValue}>
            ❤️ {run.player.hp} / {run.player.maxHp}
          </Text>
        </View>
        <View style={styles.ribbonDivider} />
        <View style={styles.ribbonItem}>
          <Text style={styles.ribbonLabel}>STATUS</Text>
          <Text
            style={[
              styles.ribbonValue,
              run.status === ROGUE_RUN_STATUS.ACTIVE
                ? styles.statusActive
                : styles.statusFinished,
            ]}
          >
            {run.status}
          </Text>
        </View>
        <View style={styles.ribbonDivider} />
        <View style={styles.ribbonItem}>
          <Text style={styles.ribbonLabel}>VISITED</Text>
          <Text style={styles.ribbonValue}>
            {visitedSet.size} / {Object.keys(run.route.nodes).length}
          </Text>
        </View>
      </View>

      {/* Status Notice */}
      {statusMessage ? (
        <View style={styles.statusBanner}>
          <Text style={styles.statusBannerText}>{statusMessage}</Text>
        </View>
      ) : null}

      {/* Completion Banner */}
      {run.status === ROGUE_RUN_STATUS.VICTORY && (
        <View style={styles.victoryCard}>
          <Text style={styles.victoryTitle}>👑 EXPEDITION VICTORY</Text>
          <Text style={styles.victoryDesc}>
            You conquered the labyrinth and reached the Boss chamber!
          </Text>
          <TouchableOpacity
            style={styles.victoryBtn}
            onPress={() => navigation.navigate('RogueHome')}
            accessibilityRole="button"
          >
            <Text style={styles.victoryBtnText}>Return to Expedition Menu</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Map Nodes View */}
      <View style={styles.mapContainer}>
        {displayRows.map(({ row, nodes }) => {
          const isBossRow = row === rowCount - 1;
          const isStartRow = row === 0;

          return (
            <View key={`row-${row}`} style={styles.mapRow}>
              <View style={styles.rowLabelContainer}>
                <Text style={styles.rowLabelText}>
                  {isBossRow ? 'BOSS' : isStartRow ? 'START' : `ROW ${row}`}
                </Text>
              </View>

              <View style={styles.nodesRow}>
                {nodes.map((node) => {
                  const isCurrent = node.id === currentNodeId;
                  const isVisited = visitedSet.has(node.id);
                  const isSelectable = selectables.includes(node.id);

                  let badgeStyle = styles.nodeNormal;
                  if (isCurrent) badgeStyle = styles.nodeCurrent;
                  else if (isSelectable) badgeStyle = styles.nodeSelectable;
                  else if (isVisited) badgeStyle = styles.nodeVisited;

                  return (
                    <TouchableOpacity
                      key={node.id}
                      style={[styles.nodeCard, badgeStyle]}
                      onPress={() => handleSelectNode(node.id)}
                      disabled={advancing || (!isSelectable && !isCurrent)}
                      accessibilityRole="button"
                      accessibilityLabel={`${node.type} node ${node.id}`}
                    >
                      <Text style={styles.nodeIcon}>{getNodeIcon(node.type)}</Text>
                      <Text style={styles.nodeType}>{node.type}</Text>
                      <Text style={styles.nodeIdText}>{node.id}</Text>

                      {isCurrent && <Text style={styles.currentTag}>📍 CURRENT</Text>}
                      {isSelectable && <Text style={styles.selectableTag}>👉 CHOOSE</Text>}
                      {isVisited && !isCurrent && (
                        <Text style={styles.visitedTag}>✓ VISITED</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function getNodeIcon(type) {
  switch (type) {
    case ROGUE_NODE_TYPES.START:
      return '🏁';
    case ROGUE_NODE_TYPES.BATTLE:
      return '⚔️';
    case ROGUE_NODE_TYPES.ELITE:
      return '🌟';
    case ROGUE_NODE_TYPES.REST:
      return '⛺';
    case ROGUE_NODE_TYPES.EVENT:
      return '❓';
    case ROGUE_NODE_TYPES.BOSS:
      return '👑';
    default:
      return '🔹';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    padding: 16,
    paddingTop: 45,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  abandonBtnSmall: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  titleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
  },
  ribbon: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  ribbonItem: {
    alignItems: 'center',
    flex: 1,
  },
  ribbonDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#334155',
  },
  ribbonLabel: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
    marginBottom: 2,
  },
  ribbonValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  statusActive: {
    color: '#10B981',
  },
  statusFinished: {
    color: '#F59E0B',
  },
  statusBanner: {
    backgroundColor: '#1E3A8A',
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  statusBannerText: {
    color: '#93C5FD',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  victoryCard: {
    backgroundColor: '#064E3B',
    borderWidth: 1,
    borderColor: '#10B981',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  victoryTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  victoryDesc: {
    color: '#A7F3D0',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },
  victoryBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  victoryBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  mapContainer: {
    backgroundColor: '#1E293B40',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  mapRow: {
    marginBottom: 16,
  },
  rowLabelContainer: {
    marginBottom: 6,
    paddingLeft: 4,
  },
  rowLabelText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 1,
  },
  nodesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    flexWrap: 'wrap',
    gap: 8,
  },
  nodeCard: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 90,
    borderWidth: 1.5,
  },
  nodeNormal: {
    backgroundColor: '#1E293B80',
    borderColor: '#334155',
    opacity: 0.6,
  },
  nodeCurrent: {
    backgroundColor: '#1E3A8A',
    borderColor: '#60A5FA',
    opacity: 1,
  },
  nodeSelectable: {
    backgroundColor: '#064E3B',
    borderColor: '#34D399',
    opacity: 1,
  },
  nodeVisited: {
    backgroundColor: '#0F172A',
    borderColor: '#475569',
    opacity: 0.7,
  },
  nodeIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  nodeType: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  nodeIdText: {
    fontSize: 9,
    color: '#94A3B8',
    marginBottom: 4,
  },
  currentTag: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#93C5FD',
  },
  selectableTag: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#6EE7B7',
  },
  visitedTag: {
    fontSize: 9,
    fontWeight: '600',
    color: '#94A3B8',
  },
});
