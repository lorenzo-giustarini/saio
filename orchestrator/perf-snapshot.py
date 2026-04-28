"""
V15.0 WS22 — Snapshot CPU/memoria per processo + figli (per PIDs forniti).

Uso: python perf-snapshot.py <pid1> <pid2> ...
Output: JSON {totalCpuPercent, processes:[{pid, name, cpu, mem_mb, status}]}

Stampa ALWAYS un JSON valido (anche su errore) per non far crashare il backend
che parsa l'output stdout.
"""
import sys
import json

try:
    import psutil
except ImportError:
    print(json.dumps({
        'totalCpuPercent': 0.0,
        'processes': [],
        'error': 'psutil_not_installed',
    }))
    sys.exit(0)


def snapshot(pids):
    procs = []
    total_cpu = 0.0
    seen_pids = set()
    for pid in pids:
        if pid in seen_pids:
            continue
        seen_pids.add(pid)
        try:
            p = psutil.Process(pid)
            # cpu_percent richiede 2 chiamate (la prima ritorna 0). Per snapshot
            # one-shot usiamo interval=0.3s che dà una misura ragionevole.
            cpu = p.cpu_percent(interval=0.3)
            mem_mb = round(p.memory_info().rss / (1024 * 1024), 1)
            name = p.name()
            status = p.status()
            procs.append({
                'pid': pid,
                'name': name,
                'cpu': round(cpu, 1),
                'mem_mb': mem_mb,
                'status': status,
            })
            total_cpu += cpu
            # Includi anche children (es. orchestrator spawna subprocess)
            for child in p.children(recursive=True):
                if child.pid in seen_pids:
                    continue
                seen_pids.add(child.pid)
                try:
                    cc = child.cpu_percent(interval=0.0)  # non-blocking re-read
                    cm = round(child.memory_info().rss / (1024 * 1024), 1)
                    procs.append({
                        'pid': child.pid,
                        'name': child.name(),
                        'cpu': round(cc, 1),
                        'mem_mb': cm,
                        'status': child.status(),
                        'parent': pid,
                    })
                    total_cpu += cc
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except psutil.NoSuchProcess:
            procs.append({'pid': pid, 'error': 'no_such_process'})
        except psutil.AccessDenied:
            procs.append({'pid': pid, 'error': 'access_denied'})
        except Exception as e:
            procs.append({'pid': pid, 'error': str(e)[:200]})
    return {
        'totalCpuPercent': round(total_cpu, 1),
        'processes': procs,
        'cpuCount': psutil.cpu_count(logical=True) or 1,
    }


def main():
    pids_arg = sys.argv[1:]
    pids = []
    for a in pids_arg:
        try:
            pids.append(int(a))
        except ValueError:
            continue
    if not pids:
        print(json.dumps({'totalCpuPercent': 0.0, 'processes': [], 'cpuCount': psutil.cpu_count(logical=True) or 1}))
        return
    result = snapshot(pids)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({
            'totalCpuPercent': 0.0,
            'processes': [],
            'error': f'snapshot_failed: {str(e)[:200]}',
        }))
