import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Flex,
  HStack,
  Heading,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spacer,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  Tag,
  Tooltip,
  useToast
} from '@chakra-ui/react';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Download, FileUp, Lock, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DMX_UNIVERSE_SIZE,
  analyzeVenueMapping,
  mappingExampleCsv,
  mappingKindLabels,
  parseMappingText
} from './venueMapping';
import type {
  ChannelMappingEntry,
  LightingPlan,
  MappingIssue,
  MappingIssueKind,
  UserRole,
  VenueMapping
} from './types';

interface VenueMappingModalProps {
  open: boolean;
  plan: LightingPlan;
  role: UserRole;
  onClose: () => void;
  onImport: (
    entries: ChannelMappingEntry[],
    venueName: string,
    source: VenueMapping['source'],
    warnings: string[]
  ) => void;
  onApply: () => void;
  onReset: () => void;
}

const kindColor: Record<MappingIssueKind, string> = {
  unmapped: 'orange',
  'duplicate-target': 'red',
  'address-overflow': 'red'
};

type IssueFilter = 'all' | 'blocking' | MappingIssueKind;

export function canApplyMapping(role: UserRole) {
  return role === 'designer' || role === 'stage-manager';
}

export function VenueMappingModal({
  open,
  plan,
  role,
  onClose,
  onImport,
  onApply,
  onReset
}: VenueMappingModalProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [venueName, setVenueName] = useState('');
  const [mappingText, setMappingText] = useState('');
  const [parseError, setParseError] = useState('');
  const [filter, setFilter] = useState<IssueFilter>('all');

  const mapping = plan.venueMapping;

  useEffect(() => {
    if (open) {
      setMappingText('');
      setVenueName('');
      setParseError('');
      setFilter('all');
    }
  }, [open]);

  const draftEntries = useMemo(() => {
    try {
      return mappingText.trim() ? parseMappingText(mappingText).entries : [];
    } catch {
      return [];
    }
  }, [mappingText]);

  const preview = useMemo(
    () => (mappingText.trim() && !mapping ? analyzeVenueMapping(plan, draftEntries) : []),
    [plan, draftEntries, mappingText, mapping]
  );
  const previewCounts = useMemo(() => {
    const issues = preview;
    return {
      total: issues.length,
      blocking: issues.filter((issue) => !issue.sceneFrozen).length,
      unmapped: issues.filter((issue) => issue.kind === 'unmapped').length,
      duplicateTarget: issues.filter((issue) => issue.kind === 'duplicate-target').length,
      addressOverflow: issues.filter((issue) => issue.kind === 'address-overflow').length,
      inFrozenScene: issues.filter((issue) => issue.sceneFrozen).length
    };
  }, [preview]);

  const issues: MappingIssue[] = useMemo(() => {
    if (!mapping || mapping.status === 'applied') return [];
    return analyzeVenueMapping(plan, mapping.entries);
  }, [plan, mapping]);

  const counts = mapping?.counts;
  const blocking = mapping?.status === 'draft' ? (counts?.blocking ?? 0) : previewCounts.blocking;
  const mayApply = canApplyMapping(role);

  function handleImport(source: 'csv' | 'json') {
    try {
      const parsed = parseMappingText(mappingText);
      if (!parsed.entries.length) {
        setParseError('没有解析出有效映射，请检查表头与原/新通道列');
        return;
      }
      onImport(parsed.entries, venueName || `${plan.name} · 巡演场馆`, source, parsed.warnings);
      setParseError('');
      toast({
        title: `已导入 ${parsed.entries.length} 条通道映射`,
        description: '当前提示尚未改动，请在待处理清单确认后再应用。',
        status: 'info',
        duration: 2600
      });
    } catch (error) {
      setParseError(error instanceof Error ? error.message : '映射解析失败');
    }
  }

  async function handleFile(file: File) {
    const text = await file.text();
    setMappingText(text);
    setVenueName((current) => current || file.name.replace(/\.[^.]+$/, ''));
    setParseError('');
  }

  function loadExample() {
    setVenueName('巡演场馆 A · 观众厅');
    setMappingText(mappingExampleCsv);
    setParseError('');
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([mappingExampleCsv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '换台通道映射模板.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function confirmApply() {
    if (!mapping || blocking > 0) return;
    const frozenSkipped = counts?.cuesInFrozenScenes ?? 0;
    const message = frozenSkipped
      ? `确认将映射应用到「${plan.name}」？\n\n· 仅改写未冻结场次的通道；\n· ${frozenSkipped} 条冻结场次提示保留原通道；\n· 跟随关系、通道叠光与全剧时间将自动重算。`
      : `确认将映射应用到「${plan.name}」？\n\n· 跟随关系、通道叠光与全剧时间将自动重算。`;
    if (!window.confirm(message)) return;
    onApply();
    toast({ title: '舞台监督已确认，映射应用并重算完成', status: 'success', duration: 2600 });
  }

  const shownIssues = mapping
    ? issues.filter((issue) => {
        if (filter === 'all') return true;
        if (filter === 'blocking') return !issue.sceneFrozen;
        return issue.kind === filter;
      })
    : preview.filter((issue) => {
        if (filter === 'all') return true;
        if (filter === 'blocking') return !issue.sceneFrozen;
        return issue.kind === filter;
      });

  return (
    <Modal isOpen={open} onClose={onClose} size="4xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent bg="stage.900" borderColor="whiteAlpha.100">
        <ModalHeader borderBottomWidth="1px" borderColor="whiteAlpha.100">
          <HStack>
            <ArrowLeftRight size={18} color="#f6c453" />
            <Box>
              <Heading size="sm">巡演换台对账</Heading>
              <Text color="whiteAlpha.500" fontSize="xs" fontWeight="400">
                {plan.name} · 导入新场馆通道映射，核对未映射、重复占用与超出每宇宙 {DMX_UNIVERSE_SIZE} 路的项目
              </Text>
            </Box>
            {mapping ? (
              <Tag colorScheme={mapping.status === 'draft' ? 'orange' : 'green'} ml="auto">
                {mapping.status === 'draft' ? '待确认' : '已应用'}
              </Tag>
            ) : null}
          </HStack>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody py={4}>
          {!mapping ? (
            <Stack spacing={4}>
              <Alert status="info" borderRadius="lg">
                <AlertIcon />
                <AlertDescription fontSize="sm">
                  导入映射只生成待处理清单，不会改动当前提示。舞台监督确认前可随时取消；确认后仅对未冻结场次改写通道并自动重算跟随、叠光与全剧时间。
                </AlertDescription>
              </Alert>

              <HStack align="flex-end">
                <Box flex="1">
                  <Text color="whiteAlpha.700" fontSize="xs" fontWeight="600" mb={1}>新场馆名称</Text>
                  <Input
                    value={venueName}
                    placeholder="例如：巡演场馆 A · 观众厅"
                    onChange={(event) => setVenueName(event.target.value)}
                  />
                </Box>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.json,text/csv,application/json,text/plain"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                    event.target.value = '';
                  }}
                />
                <Button leftIcon={<FileUp size={15} />} onClick={() => fileInputRef.current?.click()}>
                  选择映射文件
                </Button>
                <Button variant="ghost" leftIcon={<Download size={15} />} onClick={downloadTemplate}>
                  下载模板
                </Button>
                <Button variant="ghost" size="sm" onClick={loadExample}>填入示例</Button>
              </HStack>

              <Box>
                <Text color="whiteAlpha.700" fontSize="xs" fontWeight="600" mb={1}>
                  映射内容（CSV：原通道, 新通道, 宇宙, 地址, 备注；也可粘贴 JSON 数组）
                </Text>
                <Textarea
                  value={mappingText}
                  onChange={(event) => {
                    setMappingText(event.target.value);
                    setParseError('');
                  }}
                  minH="180px"
                  fontFamily="mono"
                  fontSize="xs"
                  placeholder={'原通道,新通道,宇宙,地址,备注\nGrand Master,Master,1,1,新场总控\nCyc 1,Cyc A,1,10'}
                />
              </Box>

              {parseError ? (
                <Alert status="error" borderRadius="lg">
                  <AlertIcon />
                  <AlertDescription fontSize="sm">{parseError}</AlertDescription>
                </Alert>
              ) : null}

              {mappingText.trim() ? (
                <IssueSummary
                  total={previewCounts.total}
                  blocking={previewCounts.blocking}
                  unmapped={previewCounts.unmapped}
                  duplicateTarget={previewCounts.duplicateTarget}
                  addressOverflow={previewCounts.addressOverflow}
                  inFrozenScene={previewCounts.inFrozenScene}
                />
              ) : null}

              {shownIssues.length ? <IssueTable issues={shownIssues} /> : null}
            </Stack>
          ) : (
            <Stack spacing={4}>
              <Flex align="center" gap={3} wrap="wrap">
                <Box>
                  <Heading size="xs">{mapping.venueName}</Heading>
                  <Text color="whiteAlpha.500" fontSize="xs">
                    {mapping.entries.length} 条映射 · {mapping.status === 'draft' ? `导入于 ${formatDate(mapping.importedAt)}` : `应用于 ${formatDate(mapping.applyResult?.appliedAt ?? '')}`}
                  </Text>
                </Box>
                <Spacer />
                {mapping.status === 'applied' ? <Tag colorScheme="green"><HStack spacing={1}><CheckCircle2 size={12} /><Text>已重算</Text></HStack></Tag> : <Tag colorScheme="orange">草稿对账中</Tag>}
              </Flex>

              {mapping.parseWarnings.length ? (
                <Alert status="warning" borderRadius="lg">
                  <AlertIcon />
                  <AlertDescription fontSize="sm">{mapping.parseWarnings.join('；')}</AlertDescription>
                </Alert>
              ) : null}

              {mapping.status === 'applied' ? (
                <Alert status="success" borderRadius="lg">
                  <AlertIcon />
                  <AlertDescription fontSize="sm">
                    已对 {mapping.applyResult?.mappedCueCount ?? 0} 条未冻结场次提示应用新通道；
                    {mapping.applyResult?.skippedFrozenCueCount ?? 0} 条冻结场次提示保留原通道。
                    跟随关系、通道叠光检测与全剧时间已重算。如需撤销可使用 Ctrl/⌘+Z。
                  </AlertDescription>
                </Alert>
              ) : (
                <IssueSummary
                  total={counts?.total ?? 0}
                  blocking={counts?.blocking ?? 0}
                  unmapped={counts?.unmapped ?? 0}
                  duplicateTarget={counts?.duplicateTarget ?? 0}
                  addressOverflow={counts?.addressOverflow ?? 0}
                  inFrozenScene={counts?.inFrozenScene ?? 0}
                />
              )}

              {mapping.status === 'draft' ? (
                <>
                  <HStack>
                    <FilterButton current={filter} value="all" label={`全部 ${counts?.total ?? 0}`} onChange={setFilter} />
                    <FilterButton current={filter} value="blocking" label={`待处理 ${counts?.blocking ?? 0}`} onChange={setFilter} />
                    <FilterButton current={filter} value="unmapped" label={`未映射 ${counts?.unmapped ?? 0}`} onChange={setFilter} />
                    <FilterButton current={filter} value="duplicate-target" label={`重复占用 ${counts?.duplicateTarget ?? 0}`} onChange={setFilter} />
                    <FilterButton current={filter} value="address-overflow" label={`超 512 路 ${counts?.addressOverflow ?? 0}`} onChange={setFilter} />
                  </HStack>
                  <IssueTable issues={shownIssues} />
                </>
              ) : (counts?.inFrozenScene ?? 0) > 0 ? (
                <Alert status="warning" borderRadius="lg">
                  <AlertIcon />
                  <AlertDescription fontSize="sm">
                    仍有 {counts?.inFrozenScene} 个待处理项命中已冻结场次，解除冻结并修正映射后可重新对账。
                  </AlertDescription>
                </Alert>
              ) : null}

              <Box>
                <Text color="whiteAlpha.600" fontSize="xs" fontWeight="700" mb={2}>映射记录（{mapping.entries.length}）</Text>
                <Box maxH="180px" overflowY="auto" borderRadius="lg" borderWidth="1px" borderColor="whiteAlpha.100">
                  <Table size="sm" variant="simple">
                    <Thead position="sticky" top={0} bg="stage.900">
                      <Tr>
                        <Th>原通道</Th><Th>新通道</Th><Th isNumeric>宇宙</Th><Th isNumeric>地址</Th><Th>备注</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {mapping.entries.map((entry) => (
                        <Tr key={entry.sourceChannel}>
                          <Td fontFamily="mono" fontSize="xs">{entry.sourceChannel}</Td>
                          <Td fontFamily="mono" fontSize="xs" color="amber.300">{entry.targetChannel}</Td>
                          <Td isNumeric fontFamily="mono" fontSize="xs">{entry.dmxUniverse ?? '—'}</Td>
                          <Td isNumeric fontFamily="mono" fontSize="xs" color={entry.dmxAddress !== undefined && entry.dmxAddress > DMX_UNIVERSE_SIZE ? 'red.300' : undefined}>{entry.dmxAddress ?? '—'}</Td>
                          <Td fontSize="xs" color="whiteAlpha.500">{entry.note ?? ''}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Box>
              </Box>
            </Stack>
          )}
        </ModalBody>

        <ModalFooter borderTopWidth="1px" borderColor="whiteAlpha.100">
          {!mapping ? (
            <ButtonGroup>
              <Button variant="ghost" onClick={onClose}>取消</Button>
              <Tooltip
                label={mappingText.trim() ? '' : '请先粘贴或选择映射文件'}
                isDisabled={Boolean(mappingText.trim())}
              >
                <Button
                  colorScheme="amber"
                  isDisabled={!draftEntries.length}
                  onClick={() => handleImport(mappingText.trim().startsWith('[') || mappingText.trim().startsWith('{') ? 'json' : 'csv')}
                >
                  导入并生成待处理清单
                </Button>
              </Tooltip>
            </ButtonGroup>
          ) : mapping.status === 'draft' ? (
            <ButtonGroup>
              <Button variant="ghost" colorScheme="red" leftIcon={<X size={15} />} onClick={onReset}>
                放弃对账
              </Button>
              <Button variant="ghost" onClick={onClose}>稍后处理（草稿保留）</Button>
              {!mayApply ? (
                <Tooltip label="仅灯光设计或舞台监督可以确认应用映射">
                  <Button colorScheme="green" isDisabled leftIcon={<Lock size={15} />}>舞台监督确认应用</Button>
                </Tooltip>
              ) : (
                <Tooltip label={blocking > 0 ? '仍有未冻结场次的待处理项，修正映射后才能应用' : ''} isDisabled={blocking === 0}>
                  <Button colorScheme="green" isDisabled={blocking > 0} leftIcon={<CheckCircle2 size={15} />} onClick={confirmApply}>
                    舞台监督确认应用
                  </Button>
                </Tooltip>
              )}
            </ButtonGroup>
          ) : (
            <ButtonGroup>
              <Button variant="ghost" onClick={onClose}>关闭</Button>
              <Button colorScheme="amber" variant="outline" leftIcon={<AlertTriangle size={15} />} onClick={onReset}>
                重新对账
              </Button>
            </ButtonGroup>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function FilterButton({
  current,
  value,
  label,
  onChange
}: {
  current: IssueFilter;
  value: IssueFilter;
  label: string;
  onChange: (value: IssueFilter) => void;
}) {
  return (
    <Button
      size="xs"
      variant={current === value ? 'solid' : 'outline'}
      colorScheme={current === value ? 'amber' : 'whiteAlpha'}
      onClick={() => onChange(value)}
    >
      {label}
    </Button>
  );
}

function IssueSummary(props: {
  total: number;
  blocking: number;
  unmapped: number;
  duplicateTarget: number;
  addressOverflow: number;
  inFrozenScene: number;
}) {
  const items = [
    { label: '待处理项合计', value: props.total, color: props.total ? 'orange' : 'green' },
    { label: '未冻结场次阻塞项', value: props.blocking, color: props.blocking ? 'red' : 'green' },
    { label: '未映射', value: props.unmapped, color: props.unmapped ? 'orange' : 'whiteAlpha' },
    { label: '重复占用', value: props.duplicateTarget, color: props.duplicateTarget ? 'red' : 'whiteAlpha' },
    { label: '超出 512 路', value: props.addressOverflow, color: props.addressOverflow ? 'red' : 'whiteAlpha' },
    { label: '命中冻结场次', value: props.inFrozenScene, color: props.inFrozenScene ? 'purple' : 'whiteAlpha' }
  ];
  return (
    <Flex gap={2} wrap="wrap">
      {items.map((item) => (
        <Box key={item.label} px={3} py={2} borderRadius="lg" bg="blackAlpha.300" minW="108px">
          <Badge colorScheme={item.color} fontSize="md" variant="unstyled" fontWeight="800">{item.value}</Badge>
          <Text color="whiteAlpha.500" fontSize="10px">{item.label}</Text>
        </Box>
      ))}
    </Flex>
  );
}

function IssueTable({ issues }: { issues: MappingIssue[] }) {
  return (
    <Box maxH="280px" overflowY="auto" borderRadius="lg" borderWidth="1px" borderColor="whiteAlpha.100">
      <Table size="sm">
        <Thead position="sticky" top={0} bg="stage.900">
          <Tr>
            <Th w="86px">类型</Th>
            <Th>场次 / 提示</Th>
            <Th>原通道 → 新通道</Th>
            <Th w="92px">宇宙/地址</Th>
            <Th w="92px">场次状态</Th>
          </Tr>
        </Thead>
        <Tbody>
          {issues.map((issue) => (
            <Tr key={issue.id}>
              <Td>
                <Badge colorScheme={kindColor[issue.kind]}>{mappingKindLabels[issue.kind]}</Badge>
              </Td>
              <Td>
                <Text fontSize="xs" fontWeight="600">{issue.sceneName} · {issue.cueNumber} {issue.cueLabel}</Text>
                <Text color="red.200" fontSize="10px">{issue.message}</Text>
              </Td>
              <Td fontFamily="mono" fontSize="xs" whiteSpace="normal">
                {issue.sourceChannel}{issue.targetChannel ? ` → ${issue.targetChannel}` : ''}
              </Td>
              <Td fontFamily="mono" fontSize="xs">
                {issue.dmxUniverse !== undefined || issue.dmxAddress !== undefined
                  ? `${issue.dmxUniverse ?? '—'}/${issue.dmxAddress ?? '—'}`
                  : '—'}
              </Td>
              <Td>
                {issue.sceneFrozen ? (
                  <Tag size="sm" colorScheme="purple"><HStack spacing={1}><Lock size={11} /><Text>冻结</Text></HStack></Tag>
                ) : (
                  <Tag size="sm" colorScheme="orange">待处理</Tag>
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
}

function formatDate(iso: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
