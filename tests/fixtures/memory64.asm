; Original multiboot probe: the host supplies a high physical page at 0x300020.
; Map that page into long mode, check zero-fill, then write/read its final qword.
; nasm -f bin tests/fixtures/memory64.asm -o tests/fixtures/memory64.bin
bits 32
org 0x100000
header:
dd 0x1badb002, 0x10000, -(0x1badb002 + 0x10000)
dd header, header, image_end, image_end, start
start:
cli
cld
lgdt [gdt_ptr]
jmp 8:protected
protected:
mov ax, 16
mov ds, ax
mov es, ax
mov ss, ax
mov esp, 0x3f0000
xor eax, eax
mov edi, 0x200000
mov ecx, 0x1000
rep stosd
mov dword [0x200000], 0x201003
mov dword [0x201000], 0x202003
mov dword [0x201008], 0x203003
mov edi, 0x202000
mov eax, 0x83
mov ecx, 512
.identity:
mov [edi], eax
add eax, 0x200000
add edi, 8
loop .identity
mov eax, [0x300020]
or eax, 0x83
mov [0x203000], eax
mov eax, [0x300024]
mov [0x203004], eax
mov eax, cr4
or eax, 0x20
mov cr4, eax
mov eax, 0x200000
mov cr3, eax
mov ecx, 0xc0000080
rdmsr
or eax, 0x100
wrmsr
mov eax, cr0
or eax, 0x80010000
mov cr0, eax
jmp 24:long_mode
bits 64
default abs
long_mode:
mov edi, 0x401ffff8
cmp qword [rdi], 0
jne failed
mov rax, 0x123456789abcdef0
mov [rdi], rax
cmp [rdi], rax
jne failed
mov [0x300008], rax
mov dword [0x300000], 0xc064c064
halt:
hlt
jmp halt
failed:
mov dword [0x300000], 0xbad
jmp halt
align 8
gdt:
dq 0, 0x00cf9a000000ffff, 0x00cf92000000ffff, 0x00af9a000000ffff
gdt_ptr:
dw 31
dd gdt
image_end:
