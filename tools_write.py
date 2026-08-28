import sys, os
def main():
    if len(sys.argv) < 2:
        return
    path = sys.argv[1]
    data = sys.stdin.read()
    dirpath = os.path.dirname(path)
    if dirpath:
        os.makedirs(dirpath, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(data)

if __name__ == '__main__':
    main()
