; Small, original boot probes. No OS image or third-party guest code needed.
; nasm -f bin [-DX64=1] pc.asm -o x86[_64].img
bits 16
org 0x7c00
cli
xor ax, ax
mov ds, ax
mov es, ax
mov ss, ax
mov sp, 0x7c00
lgdt [gdt_ptr]
mov eax, cr0
or eax, 1
mov cr0, eax
jmp 0x08:protected
bits 32
protected:
mov ax, 0x10
mov ds, ax
mov es, ax
mov ss, ax
mov esp, 0x7c00
%ifdef X64
; Identity-map 2 MiB and enable long mode.
mov edi, 0x1000
xor eax, eax
mov ecx, 0xc00
rep stosd
mov dword [0x1000], 0x2003
mov dword [0x2000], 0x3003
mov dword [0x3000], 0x83
mov eax, cr4
or eax, 0x20
mov cr4, eax
mov eax, 0x1000
mov cr3, eax
mov ecx, 0xc0000080
rdmsr
or eax, 0x100
wrmsr
mov eax, cr0
or eax, 0x80000000
mov cr0, eax
jmp 0x18:long_mode
bits 64
long_mode:
mov rax, 0x123456789abcdef0
mov rbx, 0x123456789abcdeef
sub rax, rbx
cmp rax, 1
jne halt
%endif
mov esi, message
print:
lodsb
test al, al
jz echo
mov dx, 0x3f8
out dx, al
jmp print
echo:
mov dx, 0x3fd
in al, dx
test al, 1
jz echo
mov dx, 0x3f8
in al, dx
out dx, al
jmp echo
halt:
hlt
jmp halt
align 8
gdt:
dq 0
; flat 32-bit code and data, then 64-bit code
dq 0x00cf9a000000ffff
dq 0x00cf92000000ffff
dq 0x00af9a000000ffff
gdt_ptr:
dw $ - gdt - 1
dd gdt
%ifdef X64
message: db 'UTM-X64-LONG-MODE-OK',10,0
%else
message: db 'UTM-X86-PROTECTED-MODE-OK',10,0
%endif
times 510-($-$$) db 0
dw 0xaa55
times 1440*1024-($-$$) db 0
